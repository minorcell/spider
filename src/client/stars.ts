export const REPO = 'minorcell/spider';
export const REPO_STARS = '6';

const API = `https://api.github.com/repos/${REPO}`;

export function syncStars(doc: Document, fetcher: typeof fetch = globalThis.fetch): void {
  const slot = doc.querySelector<HTMLElement>('#github-stars-count');
  if (!slot || !fetcher) return;
  void readStars(fetcher).then((count) => {
    if (count == null) return;
    slot.textContent = formatStars(count);
  });
}

export async function readStars(fetcher: typeof fetch): Promise<number | null> {
  try {
    const response = await fetcher(API, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const count = ((await response.json()) as { stargazers_count?: unknown } | null)
      ?.stargazers_count;
    return typeof count === 'number' && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

export function formatStars(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}
