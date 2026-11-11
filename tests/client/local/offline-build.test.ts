// @vitest-environment node
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { offlinePlugin, offlineWorkerSource } from '@/build/offline';

const scope = 'https://example.com/spider/';
const prefix = 'spider-offline-' + encodeURIComponent(scope) + ':';

type LifecycleEvent = { waitUntil: (work: Promise<unknown>) => void };
type FetchEvent = {
  request: Pick<Request, 'url' | 'mode' | 'method'>;
  respondWith: (response: Promise<Response>) => void;
};
type WorkerEvents = { install: LifecycleEvent; activate: LifecycleEvent; fetch: FetchEvent };

function worker() {
  const handlers: { [Name in keyof WorkerEvents]?: (event: WorkerEvents[Name]) => void } = {};
  const cache = {
    add: vi.fn<(url: string) => Promise<void>>().mockRejectedValue(new Error('optional missing')),
    addAll: vi.fn<(requests: Request[]) => Promise<void>>().mockResolvedValue(undefined),
    match: vi.fn<(url: string) => Promise<Response | undefined>>(),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [
      prefix + 'old',
      prefix + 'test',
      'spider-offline-' + encodeURIComponent('https://example.com/other/') + ':old',
      'spider-offline-legacy',
      'webllm/model',
    ]),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn<(request: Request, options?: RequestInit) => Promise<Response>>();
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  runInNewContext(
    offlineWorkerSource(['index.html', 'assets/journal.worker.js', 'og.png'], 'test'),
    {
      URL,
      Request,
      caches,
      fetch,
      self: {
        registration: { scope },
        skipWaiting,
        clients: { claim },
        addEventListener: <Name extends keyof WorkerEvents>(
          name: Name,
          handler: (event: WorkerEvents[Name]) => void,
        ) => {
          handlers[name] = handler;
        },
      },
    },
  );
  function lifecycle(name: 'install' | 'activate') {
    const waitUntil = vi.fn<(work: Promise<unknown>) => void>();
    handlers[name]!({ waitUntil });
    return waitUntil.mock.calls[0][0];
  }
  function request(url: string, mode: RequestMode = 'navigate', method = 'GET') {
    const respondWith = vi.fn<(response: Promise<Response>) => void>();
    handlers.fetch!({ request: { url, mode, method }, respondWith });
    return respondWith.mock.calls[0]?.[0];
  }
  return { cache, caches, fetch, skipWaiting, claim, lifecycle, request };
}

it('takes over only after the required application assets have been cached', async () => {
  const { cache, caches, skipWaiting, claim, lifecycle } = worker();

  cache.addAll.mockRejectedValueOnce(new Error('core missing'));
  await expect(lifecycle('install')).rejects.toThrow('core missing');
  expect(skipWaiting).not.toHaveBeenCalled();

  await lifecycle('install');
  expect(
    cache.addAll.mock.calls.at(-1)?.[0].map((request) => [request.url, request.cache]),
  ).toEqual([
    [scope + 'index.html', 'reload'],
    [scope + 'assets/journal.worker.js', 'reload'],
  ]);
  expect(cache.add).toHaveBeenCalledWith(scope + 'og.png');
  expect(skipWaiting).toHaveBeenCalledOnce();

  await lifecycle('activate');
  expect(claim).toHaveBeenCalledOnce();
  expect(caches.delete.mock.calls).toEqual([[prefix + 'old']]);
  expect(offlinePlugin().apply).toBe('build');
});

it('loads deployed pages from the network and uses the cached page when disconnected', async () => {
  const { cache, caches, fetch, request } = worker();
  const deployed = new Response('deployed application');
  const installed = new Response('installed application');
  cache.match.mockResolvedValue(installed);
  fetch.mockResolvedValue(deployed);

  await expect(request(scope + '?mode=play')).resolves.toBe(deployed);
  await expect(request(scope + 'index.html')).resolves.toBe(deployed);
  expect(cache.match).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: scope + '?mode=play' }), {
    cache: 'no-cache',
  });

  const unavailable = new Response('unavailable', { status: 503 });
  fetch.mockResolvedValueOnce(unavailable);
  await expect(request(scope)).resolves.toBe(unavailable);

  fetch.mockRejectedValueOnce(new TypeError('network disconnected'));
  await expect(request(scope)).resolves.toBe(installed);
  expect(caches.open).toHaveBeenLastCalledWith(prefix + 'test');
  expect(cache.match).toHaveBeenLastCalledWith(scope + 'index.html');

  const disconnected = new TypeError('network disconnected');
  fetch.mockRejectedValueOnce(disconnected);
  cache.match.mockResolvedValueOnce(undefined);
  await expect(request(scope)).rejects.toBe(disconnected);
});

it('serves cached assets and ignores requests outside the application', async () => {
  const { cache, fetch, request } = worker();
  const cached = new Response('cached asset');
  const downloaded = new Response('downloaded asset');
  cache.match.mockResolvedValueOnce(cached);
  fetch.mockResolvedValue(downloaded);

  await expect(request(scope + 'assets/journal.worker.js', 'same-origin')).resolves.toBe(cached);
  expect(fetch).not.toHaveBeenCalled();
  await expect(request(scope + 'og.png', 'same-origin')).resolves.toBe(downloaded);
  expect(request(scope, 'navigate', 'POST')).toBeUndefined();
  expect(request('https://api.example.com/v1')).toBeUndefined();
  expect(request('https://example.com/private')).toBeUndefined();
  expect(request(scope + 'api/state', 'same-origin')).toBeUndefined();
  expect(fetch).toHaveBeenCalledOnce();
});
