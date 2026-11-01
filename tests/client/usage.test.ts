import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelUsage } from 'ai';
import { openSpiderDb, resetSpiderDb, type UsageDay } from '../../src/client/journal/db.js';
import { formatTokens, readUsage, recordUsage } from '../../src/client/journal/usage.js';

function usage(
  input: number | undefined,
  output: number | undefined,
  total: number | undefined,
  cache?: number,
  reasoning?: number,
): LanguageModelUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: cache,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: reasoning },
  };
}

beforeEach(async () => {
  await resetSpiderDb();
});

describe('recordUsage', () => {
  const day = new Date(2026, 10, 2, 15);

  it('ignores a call that reported no tokens', async () => {
    await recordUsage(null, day);
    await recordUsage(undefined, day);
    await recordUsage(usage(undefined, undefined, undefined), day);
    expect((await readUsage('2026-11-02')).days).toEqual([]);
  });

  it('adds a call onto the local day and sums later calls', async () => {
    await recordUsage(usage(10, 2, 12, 4, 1), day);
    await recordUsage(usage(1, 1, 2), day);
    await recordUsage(usage(3, 0, 3), new Date(2026, 10, 1, 9));
    const snapshot = await readUsage('2026-11-02');
    expect(snapshot.today).toMatchObject({
      date: '2026-11-02',
      input: 11,
      output: 3,
      total: 14,
      calls: 2,
      cacheRead: 4,
      reasoning: 1,
    });
    expect(snapshot.sum).toMatchObject({ input: 14, output: 3, total: 17, calls: 3, cacheRead: 4 });
    expect(snapshot.days.map((row) => row.date)).toEqual(['2026-11-02', '2026-11-01']);
  });

  it('counts an explicit zero and fills missing detail', async () => {
    await recordUsage(
      { inputTokens: 0, outputTokens: undefined, totalTokens: undefined } as LanguageModelUsage,
      day,
    );
    expect((await readUsage('2026-11-02')).today).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
      calls: 1,
      cacheRead: 0,
      reasoning: 0,
    });
  });

  it('drops non-finite and negative numbers', async () => {
    const db = await openSpiderDb();
    await db.put('usage', {
      date: '2026-11-02',
      input: -5,
      output: Number.NaN,
      total: 'no',
      calls: 1.9,
      cacheRead: undefined,
      reasoning: Number.POSITIVE_INFINITY,
    } as unknown as UsageDay);
    const snapshot = await readUsage('2026-11-03');
    expect(snapshot.days[0]).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
      calls: 1,
      cacheRead: 0,
      reasoning: 0,
    });
    expect(snapshot.today).toMatchObject({ date: '2026-11-03', calls: 0 });
    expect(snapshot.sum.calls).toBe(1);
  });

  it('keeps going when the ledger cannot be written', async () => {
    const db = await openSpiderDb();
    const transaction = vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('usage down');
    });
    await expect(recordUsage(usage(1, 1, 2), day)).resolves.toBeUndefined();
    transaction.mockRestore();
    expect((await readUsage('2026-11-02')).days).toEqual([]);
  });
});

describe('formatTokens', () => {
  it('keeps small counts and compacts thousands, millions, and billions', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(123_456)).toBe('123.5k');
    expect(formatTokens(999_500)).toBe('999.5k');
    expect(formatTokens(1_500_000)).toBe('1.5m');
    expect(formatTokens(1_200_000_000)).toBe('1.2b');
    expect(formatTokens(999_950)).toBe('1m');
    expect(formatTokens(2_000_000_000_000)).toBe('2000b');
  });
});

function openLegacy(stores: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('spider', 1);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      for (const name of stores) database.createObjectStore(name, { keyPath: 'date' });
    });
    request.addEventListener('success', () => {
      request.result.close();
      resolve();
    });
    request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
  });
}

describe('openSpiderDb', () => {
  it('adds the usage store to a database created before it', async () => {
    await openLegacy(['sessions', 'memories']);
    const db = await openSpiderDb();
    expect(db.objectStoreNames.contains('usage')).toBe(true);
    expect(db.objectStoreNames.contains('sessions')).toBe(true);
  });

  it('keeps a usage store that was created ahead of the upgrade', async () => {
    await openLegacy(['sessions', 'memories', 'usage']);
    const db = await openSpiderDb();
    expect([...db.objectStoreNames].filter((name) => name === 'usage')).toEqual(['usage']);
  });
});
