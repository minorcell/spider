/** Opt-in app caching; the model runtime maintains its own weight/WASM caches. */
export async function prepareOffline(): Promise<void> {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) throw new Error('此浏览器不支持离线网页缓存');
  const registration = await navigator.serviceWorker.register(
    new URL(`${import.meta.env.BASE_URL}offline-sw.js`, document.baseURI),
  );
  if (registration.active) return;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) throw new Error('离线网页缓存尚未准备好，请重试');
  await new Promise<void>((resolve, reject) => {
    const change = (): void => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', change);
        if (worker.state === 'activated') resolve();
        else reject(new Error('网页缓存失败，请检查可用存储空间后重试'));
      }
    };
    worker.addEventListener('statechange', change);
    change();
  });
}
