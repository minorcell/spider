import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  reload: vi.fn(),
  construct: vi.fn(),
  unload: vi.fn(),
  create: vi.fn(),
  interrupt: vi.fn(),
}));
vi.mock('@mlc-ai/web-llm', () => ({
  MLCEngine: class {
    constructor(options: {
      initProgressCallback: (report: {
        text: string;
        progress: number;
        timeElapsed: number;
      }) => void;
    }) {
      mock.construct(options);
      options.initProgressCallback({
        text: 'Fetching param cache[3/9]: 50% completed',
        progress: 0.5,
        timeElapsed: 10,
      });
    }
    reload = mock.reload;
    unload = mock.unload;
    interruptGenerate = mock.interrupt;
    chat = { completions: { create: mock.create } };
  },
}));
import { createLocalRuntime } from '../../../src/client/local/runtime.js';
const reply = {
  choices: [{ message: { content: '<think>hidden</think> done' } }],
  usage: { prompt_tokens: 5, completion_tokens: 2 },
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.unload.mockResolvedValue(undefined);
  mock.create.mockResolvedValue(reply);
});
it('loads once, shares the model, strips reasoning and releases GPU memory without deleting caches', async () => {
  const runtime = createLocalRuntime();
  expect((await runtime.localStatus()).ready).toBe(false);
  await runtime.localUnload();
  await expect(runtime.localComplete('unloaded', [])).rejects.toThrow('请先');
  await Promise.all([runtime.localLoad(), runtime.localLoad()]);
  expect(mock.reload).toHaveBeenCalledTimes(1);
  expect((await runtime.localStatus()).ready).toBe(true);
  expect(await runtime.localComplete('one', [])).toEqual({ text: 'done', input: 5, output: 2 });
  mock.create.mockResolvedValueOnce({ ...reply, choices: [{ message: { content: null } }] });
  expect((await runtime.localComplete('empty', [])).text).toBe('');
  await runtime.localUnload();
  expect(mock.unload).toHaveBeenCalledTimes(1);
  expect((await runtime.localStatus()).ready).toBe(false);
});
it('reports progress and can retry after a failed download', async () => {
  const runtime = createLocalRuntime();
  let finish!: () => void;
  mock.reload.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const loading = runtime.localLoad();
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(await runtime.localStatus()).toEqual({
    ready: false,
    text: '正在下载模型',
    progress: 0.5,
    detail: '本阶段已用 10 秒，预计还需约 10 秒（按当前速度估算）',
  });
  finish();
  await loading;
  await runtime.localUnload();
  mock.reload.mockRejectedValueOnce(new Error('network'));
  await expect(runtime.localLoad()).rejects.toThrow('network');
  expect((await runtime.localStatus()).text).toContain('加载失败');
  await runtime.localLoad();
  expect((await runtime.localStatus()).ready).toBe(true);
});
it('cancels a queued request without interrupting a different active generation', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  let finish!: (value: typeof reply) => void;
  mock.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const active = runtime.localComplete('active', []);
  await vi.waitFor(() => expect(finish).toBeDefined());
  const queued = runtime.localComplete('queued', []);
  const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  await runtime.localCancel('queued');
  await runtime.localCancel('unknown');
  expect(mock.interrupt).not.toHaveBeenCalled();
  finish(reply);
  await active;
  await rejected;
  expect(mock.create).toHaveBeenCalledTimes(1);
});
it('interrupts the active request and rejects its partial answer', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  let finish!: (value: typeof reply) => void;
  mock.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const active = runtime.localComplete('active', []);
  const rejected = expect(active).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(finish).toBeDefined());
  await runtime.localCancel('active');
  expect(mock.interrupt).toHaveBeenCalledTimes(1);
  finish(reply);
  await rejected;
  expect((await runtime.localComplete('next', [])).text).toBe('done');
});

it('preserves the load error even if cleanup fails and permits retry', async () => {
  const runtime = createLocalRuntime();
  const original = new Error('download failed');
  mock.reload.mockRejectedValueOnce(original);
  mock.unload.mockRejectedValueOnce(new Error('cleanup failed'));
  await expect(runtime.localLoad()).rejects.toBe(original);
  expect(await runtime.localStatus()).toEqual({
    ready: false,
    text: '加载失败，请检查网络、存储空间和浏览器支持后重试',
  });
  await runtime.localLoad();
  expect((await runtime.localStatus()).ready).toBe(true);
});
it('updates failure state when constructing the engine fails', async () => {
  const runtime = createLocalRuntime();
  mock.construct.mockImplementationOnce(() => {
    throw new Error('cannot initialize');
  });
  await expect(runtime.localLoad()).rejects.toThrow('cannot initialize');
  expect((await runtime.localStatus()).text).toContain('加载失败');
  expect(mock.unload).not.toHaveBeenCalled();
  await runtime.localLoad();
  expect((await runtime.localStatus()).ready).toBe(true);
});
it('uses actual context errors and rejects truncated output before any tool can execute', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  const overflow = new Error('too many prompt tokens');
  overflow.name = 'ContextWindowSizeExceededError';
  mock.create.mockRejectedValueOnce(overflow);
  await expect(
    runtime.localComplete('chinese', [{ role: 'user', content: '你好'.repeat(3000) }]),
  ).rejects.toMatchObject({
    message: '本机模型的上下文已满，请发送一条较短的新指令',
    cause: overflow,
  });
  mock.create.mockResolvedValueOnce({
    ...reply,
    choices: [{ message: { content: '{"name":"go"}' }, finish_reason: 'length' }],
  });
  await expect(runtime.localComplete('cutoff', [])).rejects.toThrow('回复达到长度限制');
  mock.create.mockRejectedValueOnce('device lost');
  await expect(runtime.localComplete('other', [])).rejects.toBe('device lost');
  expect((await runtime.localComplete('retry', [])).text).toBe('done');
});
it('loads immutable model and wasm URLs with the matching model id', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  const config = mock.construct.mock.calls[0][0].appConfig;
  expect(config.model_list).toHaveLength(1);
  expect(config.model_list[0].model).toMatch(/\/resolve\/[a-f0-9]{40}\/$/);
  expect(config.model_list[0].model_lib).toMatch(/\/[a-f0-9]{40}\/web-llm-models\/v0_2_87\/base\//);
  expect(mock.reload).toHaveBeenCalledWith(config.model_list[0].model_id, {
    context_window_size: 4096,
  });
});
