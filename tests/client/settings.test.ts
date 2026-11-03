import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contextTokensOf,
  flushSettings,
  pilotReady,
  readPilot,
  resetPilotStore,
  restoreSettings,
  writePilot,
} from '../../src/client/settings.js';
import { openSpiderDb, resetSpiderDb } from '../../src/client/journal/db.js';

beforeEach(async () => {
  await flushSettings().catch(() => undefined);
  resetPilotStore();
  await resetSpiderDb();
  localStorage.clear();
});

const EMPTY = {
  baseURL: '',
  model: '',
  apiKey: '',
  contextTokens: null,
  autoMemory: false,
};

describe('pilot settings', () => {
  it('starts empty', () => {
    expect(readPilot()).toEqual(EMPTY);
  });

  it('round-trips trimmed values and strips trailing slashes', () => {
    writePilot({ baseURL: ' https://example.com/// ', model: ' gpt ', apiKey: ' key ' });
    expect(readPilot()).toEqual({
      ...EMPTY,
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
    });
  });

  it('stores a context length and drops a legacy compact threshold', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 8,
    });
    expect(readPilot()).toMatchObject({ contextTokens: 8 });
    expect(readPilot()).not.toHaveProperty('compact');
    localStorage.setItem(
      'spider.pilot',
      JSON.stringify({
        baseURL: 'https://example.com',
        model: 'gpt',
        apiKey: 'key',
        contextTokens: 8,
        compact: true,
        compactKb: 400,
      }),
    );
    resetPilotStore();
    expect(readPilot()).toEqual({
      ...EMPTY,
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 8,
    });
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 0,
    });
    expect(readPilot().contextTokens).toBeNull();
    expect(localStorage.getItem('spider.pilot')).not.toContain('compact');
  });

  it('stores auto memory as an opt-in flag', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      autoMemory: true,
    });
    expect(readPilot().autoMemory).toBe(true);
    writePilot({ baseURL: 'https://example.com', model: 'gpt', apiKey: 'key' });
    expect(readPilot().autoMemory).toBe(true);
    writePilot({ ...readPilot(), autoMemory: false });
    expect(readPilot().autoMemory).toBe(false);
  });

  it('reads integers written as strings', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: '8' as unknown as number,
    });
    expect(readPilot()).toMatchObject({ contextTokens: 8 });
  });

  it('ignores fields of the wrong type', () => {
    localStorage.setItem(
      'spider.pilot',
      JSON.stringify({ baseURL: 1, model: null, apiKey: { key: 'x' } }),
    );
    expect(readPilot()).toEqual(EMPTY);
  });

  it('falls back to empty on malformed JSON', () => {
    localStorage.setItem('spider.pilot', '{nope');
    expect(readPilot()).toEqual(EMPTY);
  });

  it('keeps the legacy key when the new record is unusable', () => {
    localStorage.setItem('spider.pilot', '{nope');
    localStorage.setItem(
      'p5-art.pilot',
      JSON.stringify({ baseURL: 'https://old.example', model: 'o', apiKey: 'old' }),
    );
    expect(readPilot()).toMatchObject({
      baseURL: 'https://old.example',
      model: 'o',
      apiKey: 'old',
    });
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
    expect(localStorage.getItem('spider.pilot')).toContain('old.example');
  });

  it('migrates the previous p5-art key', () => {
    localStorage.setItem(
      'p5-art.pilot',
      JSON.stringify({ baseURL: 'https://example.com', model: 'gpt', apiKey: 'key' }),
    );
    expect(readPilot()).toMatchObject({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
    });
    expect(localStorage.getItem('spider.pilot')).toBeTruthy();
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
  });

  it('keeps the new key when both exist', () => {
    writePilot({ baseURL: 'https://new.example', model: 'n', apiKey: 'k' });
    localStorage.setItem(
      'p5-art.pilot',
      JSON.stringify({ baseURL: 'https://old.example', model: 'o', apiKey: 'old' }),
    );
    resetPilotStore();
    expect(readPilot().baseURL).toBe('https://new.example');
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
  });

  it('keeps the new key when the old one cannot be deleted', () => {
    writePilot({ baseURL: 'https://new.example', model: 'n', apiKey: 'k' });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readPilot().baseURL).toBe('https://new.example');
    writePilot({ baseURL: 'https://newer.example', model: 'n', apiKey: 'k' });
    remove.mockRestore();
  });

  it('falls back to empty when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readPilot()).toEqual(EMPTY);
  });

  it('returns detached settings and preserves omitted options', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 8,
      autoMemory: true,
    });
    const detached = readPilot();
    detached.model = 'changed';
    expect(readPilot().model).toBe('gpt');
    writePilot({ baseURL: 'https://other.example', model: 'next', apiKey: 'new' });
    expect(readPilot()).toMatchObject({ contextTokens: 8, autoMemory: true });
    writePilot({ ...readPilot(), contextTokens: null, autoMemory: false });
    expect(readPilot()).toMatchObject({ contextTokens: null, autoMemory: false });
  });

  it('needs all three fields', () => {
    expect(pilotReady({ baseURL: 'a', model: 'b', apiKey: 'c' })).toBe(true);
    expect(pilotReady({ baseURL: '', model: 'b', apiKey: 'c' })).toBe(false);
    expect(pilotReady({ baseURL: 'a', model: '', apiKey: 'c' })).toBe(false);
    expect(pilotReady({ baseURL: 'a', model: 'b', apiKey: '' })).toBe(false);
  });

  it('turns k token into tokens on the 1000 scale vendors publish', () => {
    expect(contextTokensOf(null)).toBeNull();
    expect(contextTokensOf(8)).toBe(8000);
    expect(contextTokensOf(128)).toBe(128_000);
  });
});

describe('persistent settings', () => {
  it('restores IndexedDB after the synchronous recovery buffer is lost', async () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'saved',
      apiKey: 'key',
      contextTokens: 32,
      autoMemory: true,
    });
    await flushSettings();
    localStorage.clear();
    resetPilotStore();

    await restoreSettings();

    expect(readPilot()).toMatchObject({ model: 'saved', contextTokens: 32, autoMemory: true });
    expect(localStorage.getItem('spider.pilot')).toContain('saved');
  });

  it('migrates both old settings keys into preferences', async () => {
    localStorage.setItem('spider.pilot', '{nope');
    localStorage.setItem('p5-art.pilot', JSON.stringify({ ...EMPTY, model: 'legacy' }));

    await restoreSettings();

    const db = await openSpiderDb();
    expect(await db.get('preferences', 'pilot')).toMatchObject({ value: { model: 'legacy' } });
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
  });

  it('migrates options saved before model credentials were filled', () => {
    for (const option of [{ contextTokens: 8 }, { autoMemory: true }]) {
      localStorage.clear();
      resetPilotStore();
      localStorage.setItem('p5-art.pilot', JSON.stringify({ ...EMPTY, ...option }));
      expect(readPilot()).toEqual({ ...EMPTY, ...option });
      expect(localStorage.getItem('p5-art.pilot')).toBeNull();
    }
  });

  it('keeps an intentionally cleared current setting over the legacy key', async () => {
    writePilot({ ...EMPTY });
    await flushSettings();
    localStorage.setItem('p5-art.pilot', JSON.stringify({ ...EMPTY, model: 'legacy' }));
    resetPilotStore();

    await restoreSettings();

    expect(readPilot()).toEqual(EMPTY);
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
  });

  it('takes the newer persistent record over an older recovery buffer', async () => {
    localStorage.setItem(
      'spider.pilot',
      JSON.stringify({ id: 'pilot', updatedAt: 1, value: { ...EMPTY, model: 'old' } }),
    );
    const db = await openSpiderDb();
    await db.put('preferences', {
      id: 'pilot',
      updatedAt: 2,
      value: { ...EMPTY, model: 'new' },
    });

    await restoreSettings();

    expect(readPilot().model).toBe('new');
  });

  it('keeps the recovery copy when mirroring a persistent record is full', async () => {
    localStorage.setItem(
      'spider.pilot',
      JSON.stringify({ id: 'pilot', updatedAt: 1, value: { ...EMPTY, model: 'old' } }),
    );
    const db = await openSpiderDb();
    await db.put('preferences', {
      id: 'pilot',
      updatedAt: 2,
      value: { ...EMPTY, model: 'new' },
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    await restoreSettings();

    expect(readPilot().model).toBe('new');
    setItem.mockRestore();
  });

  it('recovers newer synchronous settings when an earlier database write is left behind', async () => {
    localStorage.setItem(
      'spider.pilot',
      JSON.stringify({ id: 'pilot', updatedAt: 2, value: { ...EMPTY, model: 'latest' } }),
    );
    const db = await openSpiderDb();
    await db.put('preferences', {
      id: 'pilot',
      updatedAt: 1,
      value: { ...EMPTY, model: 'old' },
    });

    await restoreSettings();

    expect(readPilot().model).toBe('latest');
    expect(await db.get('preferences', 'pilot')).toMatchObject({ value: { model: 'latest' } });
  });

  it('keeps memory and the recovery buffer when IndexedDB reads or writes fail', async () => {
    localStorage.setItem('spider.pilot', JSON.stringify({ ...EMPTY, model: 'recovered' }));
    const db = await openSpiderDb();
    const get = vi.spyOn(db, 'get').mockRejectedValue(new Error('unavailable'));
    const put = vi.spyOn(db, 'put').mockRejectedValue(new Error('unavailable'));

    await restoreSettings();
    writePilot({ ...readPilot(), apiKey: 'latest' });
    await expect(flushSettings()).rejects.toThrow('unavailable');

    expect(readPilot()).toMatchObject({ model: 'recovered', apiKey: 'latest' });
    expect(localStorage.getItem('spider.pilot')).toContain('latest');
    get.mockRestore();
    put.mockRestore();
    await flushSettings();
    expect(await db.get('preferences', 'pilot')).toMatchObject({ value: { apiKey: 'latest' } });
  });

  it('keeps edits in memory when both storage systems are unavailable', async () => {
    const db = await openSpiderDb();
    const put = vi.spyOn(db, 'put').mockRejectedValue(new Error('unavailable'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    expect(() => writePilot({ ...EMPTY, model: 'retained' })).not.toThrow();
    await expect(flushSettings()).rejects.toThrow('unavailable');
    expect(readPilot().model).toBe('retained');

    setItem.mockRestore();
    put.mockRestore();
    await flushSettings();
    expect(await db.get('preferences', 'pilot')).toMatchObject({ value: { model: 'retained' } });
  });

  it('retains legacy data when its synchronous migration cannot be written', () => {
    localStorage.setItem('p5-art.pilot', JSON.stringify({ ...EMPTY, model: 'legacy' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    expect(readPilot().model).toBe('legacy');
    expect(localStorage.getItem('p5-art.pilot')).toContain('legacy');
  });

  it('ignores malformed records and keeps valid empty legacy settings', async () => {
    for (const value of [
      null,
      [],
      4,
      { id: 'other' },
      { id: 'pilot', updatedAt: 1, value: null },
    ]) {
      localStorage.setItem('spider.pilot', JSON.stringify(value));
      resetPilotStore();
      expect(readPilot()).toEqual(EMPTY);
    }
    localStorage.setItem('spider.pilot', JSON.stringify(EMPTY));
    resetPilotStore();
    expect(readPilot()).toEqual(EMPTY);
    const db = await openSpiderDb();
    await db.put('preferences', { id: 'pilot', updatedAt: 1, value: [] });
    await restoreSettings();
    expect(readPilot()).toEqual(EMPTY);
  });

  it('starts with no settings in either store', async () => {
    await restoreSettings();
    expect(readPilot()).toEqual(EMPTY);
  });

  it('does not replace edits made while a slow database is opening', async () => {
    const db = await openSpiderDb();
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.spyOn(db, 'get').mockReturnValue(pending as ReturnType<typeof db.get>);
    vi.useFakeTimers();
    const restoring = restoreSettings();
    await vi.advanceTimersByTimeAsync(1500);
    await restoring;
    vi.useRealTimers();

    writePilot({ ...EMPTY, model: 'typed' });
    release({ id: 'pilot', updatedAt: Date.now() + 10_000, value: { ...EMPTY, model: 'late' } });
    await flushSettings();

    expect(readPilot().model).toBe('typed');
  });

  it('ignores an old restoration after its cache has been reset', async () => {
    const db = await openSpiderDb();
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.spyOn(db, 'get').mockReturnValue(pending as ReturnType<typeof db.get>);
    const restoring = restoreSettings();
    resetPilotStore();
    release({ id: 'pilot', updatedAt: 1, value: { ...EMPTY, model: 'late' } });
    await restoring;
    expect(readPilot()).toEqual(EMPTY);
  });
});
