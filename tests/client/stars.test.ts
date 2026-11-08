import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatStars, readStars, REPO, syncStars } from '@/src/client/stars';

const API = `https://api.github.com/repos/${REPO}`;
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('formatStars', () => {
  it('formats counts', () => {
    expect(formatStars(0)).toBe('0');
    expect(formatStars(999)).toBe('999');
    expect(formatStars(1000)).toBe('1,000');
    expect(formatStars(1234)).toBe('1,234');
  });
});

describe('readStars', () => {
  it('requests a fresh stargazer count', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ stargazers_count: 1234 }),
    ) as unknown as typeof fetch;
    await expect(readStars(fetcher)).resolves.toBe(1234);
    expect(fetcher).toHaveBeenCalledWith(API, {
      cache: 'no-store',
      headers: { accept: 'application/vnd.github+json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('times out a stalled response', async () => {
    const fetcher = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    const result = readStars(fetcher as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('returns null on errors and invalid values', async () => {
    const denied = vi.fn(async () => jsonResponse(null, false)) as unknown as typeof fetch;
    await expect(readStars(denied)).resolves.toBeNull();
    const offline = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(readStars(offline)).resolves.toBeNull();
    for (const value of [null, '6', NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const fetcher = vi.fn(async () =>
        jsonResponse({ stargazers_count: value }),
      ) as unknown as typeof fetch;
      await expect(readStars(fetcher)).resolves.toBeNull();
    }
  });
});

describe('syncStars', () => {
  it('shows a successful count, including zero', async () => {
    document.body.innerHTML = '<span id="github-stars-count" hidden></span>';
    const fetcher = vi.fn(async () =>
      jsonResponse({ stargazers_count: 0 }),
    ) as unknown as typeof fetch;
    const stop = syncStars(document, fetcher);
    await flush();
    const slot = document.querySelector<HTMLElement>('#github-stars-count')!;
    expect(slot.textContent).toBe('0');
    expect(slot.hidden).toBe(false);
    stop();
  });

  it('shows the exact fetched number instead of rounding it', async () => {
    document.body.innerHTML = '<span id="github-stars-count" hidden></span>';
    const fetcher = vi.fn(async () => jsonResponse({ stargazers_count: 1234 }));
    const stop = syncStars(document, fetcher as unknown as typeof fetch);
    await flush();
    expect(document.querySelector('#github-stars-count')?.textContent).toBe('1,234');
    stop();
  });

  it('does not request when the count slot is missing', () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    syncStars(document, fetcher)();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('hides the count if fetch is unavailable or fails', async () => {
    document.body.innerHTML = '<span id="github-stars-count">6</span>';
    vi.stubGlobal('fetch', undefined);
    const slot = document.querySelector<HTMLElement>('#github-stars-count')!;
    syncStars(document)();
    expect(slot.hidden).toBe(true);
    expect(slot.textContent).toBe('');
    const fetcher = vi.fn(async () => jsonResponse(null, false)) as unknown as typeof fetch;
    const stop = syncStars(document, fetcher);
    await flush();
    expect(slot.hidden).toBe(true);
    expect(slot.textContent).toBe('');
    stop();
  });

  it('refreshes while visible, hides failures, and refreshes again on return', async () => {
    document.body.innerHTML = '<span id="github-stars-count" hidden></span>';
    let visible = true;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      visible ? 'visible' : 'hidden',
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ stargazers_count: 6 }))
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse({ stargazers_count: 88 }));
    const stop = syncStars(document, fetcher as unknown as typeof fetch);
    const slot = document.querySelector<HTMLElement>('#github-stars-count')!;
    await flush();
    expect(slot.textContent).toBe('6');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(slot.hidden).toBe(true);
    expect(slot.textContent).toBe('');
    visible = false;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(slot.hidden).toBe(false);
    expect(slot.textContent).toBe('88');
    stop();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('ignores an in-flight response after cleanup and avoids overlapping requests', async () => {
    document.body.innerHTML = '<span id="github-stars-count" hidden></span>';
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const stop = syncStars(document, fetcher as unknown as typeof fetch);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
    resolve(jsonResponse({ stargazers_count: 88 }));
    await flush();
    expect(document.querySelector<HTMLElement>('#github-stars-count')!.hidden).toBe(true);
  });
});
