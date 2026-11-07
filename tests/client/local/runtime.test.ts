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
import { onLocalBusy } from '../../../src/client/local/activity.js';
const reply = {
  choices: [{ message: { content: '<think>hidden</think> done' } }],
  usage: { prompt_tokens: 5, completion_tokens: 2 },
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.unload.mockResolvedValue(undefined);
  mock.interrupt.mockResolvedValue(undefined);
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
  expect(await runtime.localComplete('one', [])).toMatchObject({
    text: 'done',
    input: 5,
    output: 2,
    rawText: '<think>hidden</think> done',
  });
  mock.create.mockResolvedValueOnce({ ...reply, choices: [{ message: { content: null } }] });
  expect((await runtime.localComplete('empty', [])).text).toBe('');
  await runtime.localUnload();
  expect(mock.unload).toHaveBeenCalledTimes(1);
  expect((await runtime.localStatus()).ready).toBe(false);
});

it('streams token deltas and returns actual engine timings and the unmodified reply', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  mock.create.mockResolvedValueOnce(
    (async function* () {
      yield { choices: [{ delta: { content: '答：到了' }, finish_reason: null }] };
      yield {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          extra: { time_to_first_token_s: 0.2, prefill_tokens_per_s: 500, decode_tokens_per_s: 30 },
        },
      };
    })(),
  );
  const delta = vi.fn();
  const result = await runtime.localComplete('stream', [], { kind: 'action' }, delta);
  expect(delta).toHaveBeenCalledWith('答：到了');
  expect(result).toMatchObject({
    rawText: '答：到了',
    input: 10,
    output: 4,
    metrics: { firstTokenMs: 200, prefillTokensPerSecond: 500, decodeTokensPerSecond: 30 },
  });
  expect(mock.create.mock.calls[0][0]).toMatchObject({
    stream: true,
    stream_options: { include_usage: true },
  });
});

it('preempts a summary, keeps action history together, then retries the summary', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  let finish!: (value: typeof reply) => void;
  mock.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const summary = runtime.localComplete('summary', [{ role: 'user', content: 'diary' }], {
    kind: 'summary',
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  await runtime.localSession!('turn', true);
  const action = runtime.localComplete('action', [{ role: 'user', content: 'action' }]);
  expect(mock.interrupt).toHaveBeenCalledOnce();
  finish(reply);
  await action;
  expect(mock.create).toHaveBeenCalledTimes(2);
  await runtime.localComplete('next-tool', []);
  expect(mock.create).toHaveBeenCalledTimes(3);
  await runtime.localSession!('turn', false);
  await summary;
  expect(mock.create).toHaveBeenCalledTimes(4);
  expect(mock.create.mock.calls[3][0].messages[0].content).toBe('diary');
});

it('restores rendering during tool execution even while the action session reserves the model', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  const activity = vi.fn();
  const stop = onLocalBusy(activity);
  await runtime.localSession!('turn', true);
  expect(activity.mock.calls.map((call) => call[0])).toEqual([false]);
  let finish!: (value: typeof reply) => void;
  mock.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = runtime.localComplete('observe', []);
  expect(activity).toHaveBeenLastCalledWith(true);
  finish(reply);
  await first;
  await vi.waitFor(() => expect(activity).toHaveBeenLastCalledWith(false));
  // The spider is now executing a tool. A queued diary must not reduce clarity.
  const summary = runtime.localComplete('diary', [], { kind: 'summary' });
  expect(activity).toHaveBeenLastCalledWith(false);
  expect(mock.create).toHaveBeenCalledTimes(1);
  mock.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const next = runtime.localComplete('next', []);
  expect(activity).toHaveBeenLastCalledWith(true);
  finish(reply);
  await next;
  await vi.waitFor(() => expect(activity).toHaveBeenLastCalledWith(false));
  await runtime.localSession!('turn', false);
  await summary;
  stop();
});

it('does not retry a cancelled summary after preemption', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  let finish!: (value: typeof reply) => void;
  mock.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const summary = runtime.localComplete('summary', [], { kind: 'summary' });
  const rejected = expect(summary).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(finish).toBeDefined());
  const action = runtime.localComplete('action', []);
  await runtime.localCancel('summary');
  finish(reply);
  await action;
  await rejected;
  expect(mock.create).toHaveBeenCalledTimes(2);
});

it('coalesces stream chunks and tolerates a missing optional usage report', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  mock.create.mockResolvedValueOnce(
    (async function* () {
      now = 5;
      yield { choices: [{ delta: { content: '答：' } }] };
      now = 10;
      yield { choices: [{ delta: { content: '好了' } }] };
      now = 15;
      yield { choices: [] };
    })(),
  );
  const delta = vi.fn();
  const result = await runtime.localComplete('chunks', [], {}, delta);
  expect(delta.mock.calls.map((call) => call[0])).toEqual(['答：', '好了']);
  expect(result).toMatchObject({ input: 0, output: 0, metrics: { firstTokenMs: 5 } });
});

it('drops buffered stream chunks when cancelled between engine steps', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  vi.spyOn(performance, 'now').mockReturnValue(0);
  mock.create.mockResolvedValueOnce(
    (async function* () {
      yield { choices: [{ delta: { content: 'first' } }] };
      yield { choices: [{ delta: { content: 'buffered' } }] };
      await runtime.localCancel('cancel-stream');
      yield { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } };
    })(),
  );
  const delta = vi.fn();
  await expect(runtime.localComplete('cancel-stream', [], {}, delta)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(delta.mock.calls.map((call) => call[0])).toEqual(['first']);
});

it('retries a streamed background request after yielding the engine to an action', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  vi.spyOn(performance, 'now').mockReturnValue(0);
  mock.interrupt.mockRejectedValueOnce(new Error('interrupt race'));
  let action!: Promise<unknown>;
  mock.create
    .mockResolvedValueOnce(
      (async function* () {
        yield { choices: [{ delta: { content: 'first' } }] };
        yield { choices: [{ delta: { content: 'buffered' } }] };
        action = runtime.localComplete('priority', []);
        yield { choices: [] };
      })(),
    )
    .mockResolvedValueOnce(reply)
    .mockResolvedValueOnce(
      (async function* () {
        yield { choices: [{ delta: { content: 'finished' }, finish_reason: 'stop' }] };
      })(),
    );
  const delta = vi.fn();
  expect(await runtime.localComplete('background', [], { kind: 'summary' }, delta)).toMatchObject({
    text: 'finished',
  });
  await action;
  expect(delta.mock.calls.map((call) => call[0])).toEqual(['first', 'finished']);
});

it('retries a summary whose engine rejects the interrupted generation', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  let fail!: (error: Error) => void;
  mock.create.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const summary = runtime.localComplete('background', [], { kind: 'summary' });
  await vi.waitFor(() => expect(fail).toBeDefined());
  const action = runtime.localComplete('priority', []);
  fail(new Error('interrupted'));
  await action;
  await expect(summary).resolves.toMatchObject({ text: 'done' });
});

it('does not deadlock unloading behind a paused summary', async () => {
  const runtime = createLocalRuntime();
  await runtime.localLoad();
  await runtime.localSession!('turn', true);
  const rejected = expect(runtime.localComplete('diary', [], { kind: 'summary' })).rejects.toThrow(
    '请先',
  );
  await runtime.localUnload();
  await runtime.localSession!('turn', false);
  await rejected;
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
