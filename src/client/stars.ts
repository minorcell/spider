export const REPO = 'minorcell/spider';
const API = `https://api.github.com/repos/${REPO}`;
const REFRESH_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export function syncStars(doc: Document, fetcher: typeof fetch = globalThis.fetch): () => void {
  const slot = doc.querySelector<HTMLElement>('#github-stars-count');
  if (!slot) return () => {};
  slot.hidden = true;
  slot.textContent = '';
  if (!fetcher) return () => {};

  let active = true;
  let pending = false;
  const refresh = async (): Promise<void> => {
    if (!active || pending) return;
    pending = true;
    const count = await readStars(fetcher);
    pending = false;
    if (!active) return;
    slot.textContent = count == null ? '' : formatStars(count);
    slot.hidden = count == null;
  };
  const onVisible = (): void => {
    if (doc.visibilityState === 'visible') void refresh();
  };
  void refresh();
  const timer = setInterval(() => {
    if (doc.visibilityState === 'visible') void refresh();
  }, REFRESH_MS);
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    active = false;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  };
}

export async function readStars(fetcher: typeof fetch): Promise<number | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const response = await fetcher(API, {
        cache: 'no-store',
        headers: { accept: 'application/vnd.github+json' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const count = ((await response.json()) as { stargazers_count?: unknown } | null)
        ?.stargazers_count;
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, TIMEOUT_MS);
    });
    return await Promise.race([request, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function formatStars(count: number): string {
  return count.toLocaleString('en-US');
}
