import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Cache only the built application, never API responses or user credentials. */
export function offlinePlugin(): Plugin {
  let outDir: string;
  return {
    name: 'spider-offline',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const paths = (await readdir(outDir, { recursive: true }))
        .filter((path) => /\.(html|js|css|svg|png|woff2?)$/.test(path) && path !== 'offline-sw.js')
        .toSorted();
      const hash = createHash('sha256');
      const contents = await Promise.all(paths.map((path) => readFile(resolve(outDir, path))));
      for (const content of contents) hash.update(content);
      const source = offlineWorkerSource(paths, hash.digest('hex').slice(0, 16));
      await writeFile(resolve(outDir, 'offline-sw.js'), source);
    },
  };
}

export function offlineWorkerSource(paths: string[], version: string): string {
  return `
const PREFIX = 'spider-offline-' + encodeURIComponent(self.registration.scope) + ':';
const NAME = PREFIX + '${version}';
const SCOPE = new URL(self.registration.scope);
const INDEX = new URL('index.html', SCOPE);
const URLS = ${JSON.stringify(paths)}.map(path => new URL(path, self.registration.scope).href);
const CORE = URLS.filter(url => /\\.(html|js|css|woff2?)$/.test(url) || url.startsWith(new URL('assets/', self.registration.scope).href));
const OPTIONAL = URLS.filter(url => !CORE.includes(url));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(NAME).then(async cache => {
    await cache.addAll(CORE.map(url => new Request(url, { cache: 'reload' })));
    await Promise.allSettled(OPTIONAL.map(url => cache.add(url)));
    await self.skipWaiting();
  }));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(async keys => {
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  }));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== SCOPE.origin) return;
  if (event.request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname === INDEX.pathname)) {
    event.respondWith(fetch(event.request, { cache: 'no-cache' }).catch(async error => {
      const cached = await (await caches.open(NAME)).match(INDEX.href);
      if (cached) return cached;
      throw error;
    }));
    return;
  }
  if (!URLS.includes(url.href)) return;
  event.respondWith(caches.open(NAME).then(async cache => (await cache.match(url.href)) || fetch(event.request)));
});
`;
}
