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
const URLS = ${JSON.stringify(paths)}.map(path => new URL(path, self.registration.scope).href);
const CORE = URLS.filter(url => /\\.(html|js|css|woff2?)$/.test(url) || url.startsWith(new URL('assets/', self.registration.scope).href));
const OPTIONAL = URLS.filter(url => !CORE.includes(url));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(NAME).then(async cache => {
    await cache.addAll(CORE);
    await Promise.allSettled(OPTIONAL.map(url => cache.add(url)));
  }));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== NAME).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return;
  const target = event.request.mode === 'navigate' && url.pathname === scope.pathname
    ? new URL('index.html', scope).href : url.href;
  if (!URLS.includes(target)) return;
  event.respondWith(caches.open(NAME).then(async cache => (await cache.match(target)) || fetch(event.request)));
});
`;
}
