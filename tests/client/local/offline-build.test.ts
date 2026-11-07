// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { offlinePlugin, offlineWorkerSource } from '../../../build/offline.js';

it('pre-caches built assets and serves only the application while offline', async () => {
  // Exercise the emitted service-worker source, including nested deployment scope.
  const source = offlineWorkerSource(['index.html', 'assets/journal.worker.js', 'og.png'], 'test');
  const handlers: Record<string, (event: any) => void> = {};
  const prefix = 'spider-offline-' + encodeURIComponent('https://example.com/spider/') + ':';
  const otherPrefix = 'spider-offline-' + encodeURIComponent('https://example.com/other/') + ':';
  const cache = {
    add: vi.fn(async () => {
      throw new Error('optional missing');
    }),
    addAll: vi.fn(async () => {}),
    match: vi.fn(async () => 'cached'),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [
      prefix + 'old',
      prefix + 'test',
      otherPrefix + 'old',
      'spider-offline-legacy',
      'webllm/model',
    ]),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async () => 'network');
  runInNewContext(source, {
    URL,
    caches,
    fetch,
    self: {
      registration: { scope: 'https://example.com/spider/' },
      addEventListener: (name: string, handler: any) => {
        handlers[name] = handler;
      },
    },
  });
  let work!: Promise<unknown>;
  const waitUntil = (promise: Promise<unknown>) => {
    work = promise;
  };
  handlers.install({ waitUntil });
  await work;
  expect(cache.addAll.mock.calls[0][0]).toContain('https://example.com/spider/index.html');
  expect(cache.addAll.mock.calls[0][0].some((url: string) => url.includes('journal.worker'))).toBe(
    true,
  );
  expect(cache.add).toHaveBeenCalledWith('https://example.com/spider/og.png');
  expect(cache.addAll.mock.calls[0][0]).not.toContain('https://example.com/spider/og.png');
  cache.addAll.mockRejectedValueOnce(new Error('core missing'));
  handlers.install({ waitUntil });
  await expect(work).rejects.toThrow('core missing');
  handlers.activate({ waitUntil });
  await work;
  expect(caches.delete.mock.calls).toEqual([[prefix + 'old']]);
  const respondWith = vi.fn();
  handlers.fetch({
    request: { method: 'GET', url: 'https://example.com/spider/', mode: 'navigate' },
    respondWith,
  });
  expect(await respondWith.mock.calls[0][0]).toBe('cached');
  cache.match.mockResolvedValueOnce(undefined as never);
  handlers.fetch({
    request: { method: 'GET', url: 'https://example.com/spider/index.html', mode: 'same-origin' },
    respondWith,
  });
  expect(await respondWith.mock.calls[1][0]).toBe('network');
  handlers.fetch({ request: { method: 'POST', url: 'https://example.com/spider/' }, respondWith });
  handlers.fetch({ request: { method: 'GET', url: 'https://api.example.com/v1' }, respondWith });
  handlers.fetch({ request: { method: 'GET', url: 'https://example.com/private' }, respondWith });
  expect(respondWith).toHaveBeenCalledTimes(2);
  expect(offlinePlugin().apply).toBe('build');
});
