/** The repository the corner badge points at. */
export const REPO = 'minorcell/spider';
/** What the badge shows before the live count arrives. */
export const REPO_STARS = '6';

const API = `https://api.github.com/repos/${REPO}`;

/**
 * Show the repository's stargazer count next to the GitHub mark.
 *
 * The markup already carries a count, so a blocked or offline request simply
 * leaves that number in place. Nothing here is worth surfacing to the user.
 */
export function syncStars(doc: Document, fetcher: typeof fetch = globalThis.fetch): void {
  const slot = doc.querySelector<HTMLElement>('#github-stars-count');
  if (!slot || !fetcher) return;
  void readStars(fetcher).then((count) => {
    if (count == null) return;
    slot.textContent = formatStars(count);
  });
}

/** Ask GitHub for the count. Any answer we cannot trust reads as "unknown". */
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

/** Stars stay readable at a glance: 6, 128, 1.2k. */
export function formatStars(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}
