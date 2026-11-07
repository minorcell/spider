import { afterEach, expect, it, vi } from 'vitest';
import { prepareOffline } from '../../../src/client/local/offline.js';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('does not install a service worker on the Vite development server', async () => {
  vi.stubEnv('DEV', true);
  await expect(prepareOffline()).resolves.toBeUndefined();
});
it('reports unsupported browsers and installation failures', async () => {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('navigator', {});
  await expect(prepareOffline()).rejects.toThrow('不支持');
  const register = vi.fn().mockResolvedValue({});
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  await expect(prepareOffline()).rejects.toThrow('尚未准备好');
  const worker = new EventTarget() as EventTarget & { state: string };
  worker.state = 'redundant';
  register.mockResolvedValue({ installing: worker });
  await expect(prepareOffline()).rejects.toThrow('缓存失败');
});
it('waits for activation and reuses a completed installation', async () => {
  vi.stubEnv('DEV', false);
  const worker = new EventTarget() as EventTarget & { state: string };
  worker.state = 'installing';
  const register = vi.fn().mockResolvedValue({ installing: worker });
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  const pending = prepareOffline();
  await vi.waitFor(() => expect(register).toHaveBeenCalled());
  worker.state = 'activated';
  worker.dispatchEvent(new Event('statechange'));
  await pending;
  register.mockResolvedValueOnce({ active: worker });
  await prepareOffline();
  register.mockResolvedValueOnce({ waiting: worker });
  await prepareOffline();
});
