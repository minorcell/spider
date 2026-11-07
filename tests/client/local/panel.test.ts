import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildChrome } from '../../../src/client/panel/chrome.js';
import { bindLocalPanel } from '../../../src/client/local/panel.js';
const mock = vi.hoisted(() => ({
  load: vi.fn(),
  status: vi.fn(),
  unload: vi.fn(),
  offline: vi.fn(),
}));
vi.mock('../../../src/client/local/backend.js', () => ({
  localBackend: async () => ({
    localLoad: mock.load,
    localStatus: mock.status,
    localUnload: mock.unload,
  }),
}));
vi.mock('../../../src/client/local/offline.js', () => ({ prepareOffline: mock.offline }));
const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!;
const status = () => document.querySelector('#local-status')!.textContent;
beforeEach(() => {
  vi.resetAllMocks();
  mock.offline.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { gpu: {} });
  document.body.replaceChildren(buildChrome(document));
  mock.status.mockResolvedValue({ text: 'ready', ready: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('disables cloud fields only for local mode and downloads only after a click', async () => {
  const reflect = bindLocalPanel(document);
  reflect(true);
  expect(document.querySelector<HTMLElement>('#online-model-panel')!.hidden).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[name="apiKey"]')!.disabled).toBe(true);
  expect(mock.load).not.toHaveBeenCalled();
  button('#local-load').click();
  await vi.waitFor(() => expect(status()).toBe('ready'));
  expect(document.querySelector('#offline-status')!.textContent).toContain('开发模式');
  expect(button('#local-load').disabled).toBe(false);
  button('#local-unload').click();
  await vi.waitFor(() => expect(button('#local-unload').disabled).toBe(false));
  expect(mock.unload).toHaveBeenCalledOnce();
  reflect(false);
  expect(document.querySelector<HTMLElement>('#online-model-panel')!.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>('#local-model-panel')!.hidden).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[name="apiKey"]')!.disabled).toBe(false);
});
it('shows progress during loading and leaves retry available after failure', async () => {
  vi.stubEnv('DEV', false);
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  mock.load.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  mock.status.mockResolvedValueOnce({
    ready: false,
    text: '正在下载模型',
    progress: 0.29,
    detail: '预计还需约 22 秒',
  });
  bindLocalPanel(document)(true);
  button('#local-load').click();
  const progress = document.querySelector<HTMLProgressElement>('#local-progress')!;
  expect(progress.hidden).toBe(false);
  expect(progress.hasAttribute('value')).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(status()).toBe('正在下载模型 · 29%');
  expect(progress.value).toBe(0.29);
  expect(document.querySelector('#local-progress-detail')!.textContent).toContain('22 秒');
  expect(document.querySelector('#offline-status')!.textContent).toContain('网页已缓存');
  mock.status.mockRejectedValueOnce(new Error('closed'));
  await vi.advanceTimersByTimeAsync(500);
  reject(new Error('download failed'));
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toContain('模型加载失败');
  expect(button('#local-load').disabled).toBe(false);
  expect(progress.hidden).toBe(true);
  mock.unload.mockRejectedValueOnce(new Error('unload failed'));
  button('#local-unload').click();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toContain('释放缓存失败');
  expect(button('#local-unload').disabled).toBe(false);
});

it('ignores late polling responses after loading completes', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  let reply!: (value: unknown) => void;
  mock.load.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mock.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  bindLocalPanel(document)(true);
  button('#local-load').click();
  await vi.advanceTimersByTimeAsync(500);
  mock.status.mockResolvedValue({ ready: true, text: '本机模型已就绪', progress: 1 });
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('本机模型已就绪 · 100%');
  reply({ ready: false, text: '正在下载模型', progress: 0.1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(status()).toBe('本机模型已就绪 · 100%');
});
it('explains missing WebGPU before downloading anything', async () => {
  vi.stubGlobal('navigator', {});
  bindLocalPanel(document)(true);
  button('#local-load').click();
  await vi.waitFor(() => expect(status()).toContain('浏览器不支持'));
  expect(mock.load).not.toHaveBeenCalled();
  expect(mock.offline).not.toHaveBeenCalled();
});

it('loads the model even when page caching fails, without claiming offline readiness', async () => {
  mock.offline.mockRejectedValueOnce(new Error('storage unavailable'));
  bindLocalPanel(document)(true);
  button('#local-load').click();
  await vi.waitFor(() => expect(status()).toBe('ready'));
  expect(mock.load).toHaveBeenCalledOnce();
  expect(document.querySelector('#offline-status')!.textContent).toContain('暂不支持断网重开');
});

it.each(['resolve', 'reject'] as const)(
  'does not wait on caching or let a stale %s overwrite a newer attempt',
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    mock.offline.mockImplementationOnce(
      () =>
        new Promise<void>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    bindLocalPanel(document)(true);
    button('#local-load').click();
    await vi.waitFor(() => expect(status()).toBe('ready'));
    expect(document.querySelector('#offline-status')!.textContent).toContain('正在准备');
    button('#local-load').click();
    await vi.waitFor(() => expect(mock.load).toHaveBeenCalledTimes(2));
    const latest = document.querySelector('#offline-status')!.textContent;
    if (outcome === 'resolve') resolve();
    else reject(new Error('old attempt'));
    await Promise.resolve();
    expect(document.querySelector('#offline-status')!.textContent).toBe(latest);
  },
);
