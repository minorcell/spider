import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatStars, readStars, REPO, REPO_STARS, syncStars } from '../../src/client/stars.js';

const API = `https://api.github.com/repos/${REPO}`;

/** Let the chain inside syncStars settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatStars', () => {
  it('keeps small counts exact', () => {
    expect(formatStars(0)).toBe('0');
    expect(formatStars(6)).toBe('6');
    expect(formatStars(999)).toBe('999');
  });

  it('shortens thousands', () => {
    expect(formatStars(1000)).toBe('1k');
    expect(formatStars(1234)).toBe('1.2k');
    expect(formatStars(45000)).toBe('45k');
  });
});

describe('readStars', () => {
  it('reads the stargazer count', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ stargazers_count: 1234 }),
    ) as unknown as typeof fetch;
    await expect(readStars(fetcher)).resolves.toBe(1234);
    expect(fetcher).toHaveBeenCalledWith(API, {
      headers: { accept: 'application/vnd.github+json' },
    });
  });

  it('gives up when GitHub answers with an error', async () => {
    const fetcher = vi.fn(async () => jsonResponse(null, false)) as unknown as typeof fetch;
    await expect(readStars(fetcher)).resolves.toBeNull();
  });

  it('gives up when the request fails', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(readStars(fetcher)).resolves.toBeNull();
  });

  it('gives up on a body without a count', async () => {
    const empty = vi.fn(async () => jsonResponse(null)) as unknown as typeof fetch;
    await expect(readStars(empty)).resolves.toBeNull();

    const wrong = vi.fn(async () =>
      jsonResponse({ stargazers_count: '很多' }),
    ) as unknown as typeof fetch;
    await expect(readStars(wrong)).resolves.toBeNull();

    const broken = vi.fn(async () =>
      jsonResponse({ stargazers_count: NaN }),
    ) as unknown as typeof fetch;
    await expect(readStars(broken)).resolves.toBeNull();
  });
});

describe('syncStars', () => {
  it('writes the count into the badge', async () => {
    document.body.innerHTML = `<span id="github-stars-count">${REPO_STARS}</span>`;
    const fetcher = vi.fn(async () =>
      jsonResponse({ stargazers_count: 88 }),
    ) as unknown as typeof fetch;

    syncStars(document, fetcher);
    await flush();

    expect(document.querySelector('#github-stars-count')?.textContent).toBe('88');
  });

  it('shortens a large count in place', async () => {
    document.body.innerHTML = `<span id="github-stars-count">${REPO_STARS}</span>`;
    const fetcher = vi.fn(async () =>
      jsonResponse({ stargazers_count: 2200 }),
    ) as unknown as typeof fetch;

    syncStars(document, fetcher);
    await flush();

    expect(document.querySelector('#github-stars-count')?.textContent).toBe('2.2k');
  });

  it('leaves the static count when there is nowhere to write', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ stargazers_count: 88 }),
    ) as unknown as typeof fetch;

    syncStars(document, fetcher);
    await flush();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does nothing without a fetcher', async () => {
    document.body.innerHTML = `<span id="github-stars-count">${REPO_STARS}</span>`;

    syncStars(document, undefined as unknown as typeof fetch);
    await flush();

    expect(document.querySelector('#github-stars-count')?.textContent).toBe(REPO_STARS);
  });

  it('keeps the static count when the request fails', async () => {
    document.body.innerHTML = `<span id="github-stars-count">${REPO_STARS}</span>`;
    const fetcher = vi.fn(async () => jsonResponse(null, false)) as unknown as typeof fetch;

    syncStars(document, fetcher);
    await flush();

    expect(document.querySelector('#github-stars-count')?.textContent).toBe(REPO_STARS);
  });
});
