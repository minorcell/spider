import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openSpiderDb, resetSpiderDb } from '../../../src/client/journal/db.js';
import {
  cloudComplete,
  cloudReady,
  flushCloudSettings,
  readCloud,
  resetCloudSettings,
  restoreCloud,
  writeCloud,
  type CloudSettings,
} from '../../../src/client/cloud/settings.js';

const EMPTY: CloudSettings = {
  endpoint: '',
  region: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  ready: false,
};

const FILLED = {
  endpoint: 'https://s3.example.com/',
  region: ' us-east-1 ',
  bucket: ' spider ',
  accessKeyId: ' AKIA ',
  secretAccessKey: ' secret ',
};

beforeEach(async () => {
  await flushCloudSettings().catch(() => undefined);
  resetCloudSettings();
  await resetSpiderDb();
  localStorage.clear();
  vi.useRealTimers();
});

describe('cloud settings', () => {
  it('starts empty and trims a complete endpoint', () => {
    expect(readCloud()).toEqual(EMPTY);
    expect(cloudReady()).toBe(false);
    const stored = writeCloud(FILLED, true);
    expect(stored).toEqual({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'spider',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      ready: true,
    });
    stored.endpoint = 'mutated';
    expect(readCloud().endpoint).toBe('https://s3.example.com');
    expect(cloudReady()).toBe(true);
  });

  it('keeps ready only for the same fields, and only after a probe when they change', () => {
    writeCloud(FILLED, true);
    expect(writeCloud(FILLED, false).ready).toBe(true);
    expect(writeCloud({ ...FILLED, secretAccessKey: 'next' }, false).ready).toBe(false);
    expect(writeCloud({ ...FILLED, secretAccessKey: '' }, true).ready).toBe(false);
    expect(writeCloud(FILLED, true).ready).toBe(true);
    expect(writeCloud({ ...EMPTY }, false).ready).toBe(false);
  });

  it('needs every field', () => {
    expect(cloudComplete(EMPTY)).toBe(false);
    expect(cloudComplete({ ...FILLED, endpoint: '' })).toBe(false);
    expect(cloudComplete({ ...FILLED, region: '' })).toBe(false);
    expect(cloudComplete({ ...FILLED, bucket: '' })).toBe(false);
    expect(cloudComplete({ ...FILLED, accessKeyId: '' })).toBe(false);
    expect(cloudComplete({ ...FILLED, secretAccessKey: '' })).toBe(false);
    expect(cloudComplete(FILLED)).toBe(true);
    expect(cloudReady({ ...EMPTY, ready: true })).toBe(false);
    expect(
      cloudReady({
        ...readCloud(),
        ready: true,
        endpoint: 'https://s3.example.com',
        region: 'a',
        bucket: 'b',
        accessKeyId: 'c',
        secretAccessKey: 'd',
      }),
    ).toBe(true);
  });

  it('ignores malformed values and a storage failure', () => {
    for (const value of [
      '{',
      null,
      [],
      4,
      { id: 'other' },
      { id: 'cloud', updatedAt: Number.NaN, value: EMPTY },
      { id: 'cloud', updatedAt: 1, value: null },
      { id: 'cloud', updatedAt: 1, value: [] },
    ]) {
      localStorage.setItem('spider.cloud', JSON.stringify(value));
      resetCloudSettings();
      expect(readCloud()).toEqual(EMPTY);
    }
    localStorage.setItem('spider.cloud', '{');
    resetCloudSettings();
    expect(readCloud()).toEqual(EMPTY);
    localStorage.setItem(
      'spider.cloud',
      JSON.stringify({
        id: 'cloud',
        updatedAt: 1,
        value: {
          endpoint: 1,
          region: 1,
          bucket: 1,
          accessKeyId: 1,
          secretAccessKey: 1,
          ready: 'yes',
        },
      }),
    );
    resetCloudSettings();
    expect(readCloud()).toEqual(EMPTY);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    resetCloudSettings();
    expect(readCloud()).toEqual(EMPTY);
    getItem.mockRestore();
  });
});

describe('persistent cloud settings', () => {
  it('restores IndexedDB after the synchronous recovery buffer is lost', async () => {
    writeCloud(FILLED, true);
    await flushCloudSettings();
    localStorage.clear();
    resetCloudSettings();
    await restoreCloud();
    expect(readCloud().endpoint).toBe('https://s3.example.com');
    expect(readCloud().ready).toBe(true);
    expect(localStorage.getItem('spider.cloud')).toContain('s3.example.com');
  });

  it('takes the newer persistent record over an older recovery buffer', async () => {
    localStorage.setItem(
      'spider.cloud',
      JSON.stringify({
        id: 'cloud',
        updatedAt: 1,
        value: { ...EMPTY, endpoint: 'https://old.example' },
      }),
    );
    const db = await openSpiderDb();
    await db.put('preferences', {
      id: 'cloud',
      updatedAt: 2,
      value: { ...EMPTY, endpoint: 'https://new.example', ready: true },
    });
    await restoreCloud();
    expect(readCloud().endpoint).toBe('https://new.example');
  });

  it('keeps the recovery copy when mirroring a persistent record is full', async () => {
    localStorage.setItem(
      'spider.cloud',
      JSON.stringify({
        id: 'cloud',
        updatedAt: 1,
        value: { ...EMPTY, endpoint: 'https://old.example' },
      }),
    );
    const db = await openSpiderDb();
    await db.put('preferences', {
      id: 'cloud',
      updatedAt: 2,
      value: { ...EMPTY, endpoint: 'https://new.example' },
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    await restoreCloud();
    expect(readCloud().endpoint).toBe('https://new.example');
    setItem.mockRestore();
  });

  it('recovers newer synchronous settings when an earlier database write is left behind', async () => {
    localStorage.setItem(
      'spider.cloud',
      JSON.stringify({
        id: 'cloud',
        updatedAt: 2,
        value: { ...EMPTY, endpoint: 'https://latest.example', ready: true },
      }),
    );
    const db = await openSpiderDb();
    await db.put('preferences', {
      id: 'cloud',
      updatedAt: 1,
      value: { ...EMPTY, endpoint: 'https://old.example' },
    });
    await restoreCloud();
    expect(readCloud().endpoint).toBe('https://latest.example');
    expect(await db.get('preferences', 'cloud')).toMatchObject({
      value: { endpoint: 'https://latest.example' },
    });
  });

  it('keeps memory and the recovery buffer when IndexedDB reads or writes fail', async () => {
    localStorage.setItem(
      'spider.cloud',
      JSON.stringify({ id: 'cloud', updatedAt: 1, value: { ...EMPTY, region: 'recovered' } }),
    );
    const db = await openSpiderDb();
    const get = vi.spyOn(db, 'get').mockRejectedValue(new Error('unavailable'));
    const put = vi.spyOn(db, 'put').mockRejectedValue(new Error('unavailable'));
    await restoreCloud();
    writeCloud({ ...readCloud(), endpoint: 'https://latest.example' });
    await expect(flushCloudSettings()).rejects.toThrow('unavailable');
    expect(readCloud()).toMatchObject({ region: 'recovered', endpoint: 'https://latest.example' });
    expect(localStorage.getItem('spider.cloud')).toContain('latest.example');
    get.mockRestore();
    put.mockRestore();
    await flushCloudSettings();
    expect(await db.get('preferences', 'cloud')).toMatchObject({
      value: { endpoint: 'https://latest.example' },
    });
  });

  it('keeps edits in memory when both storage systems are unavailable', async () => {
    const db = await openSpiderDb();
    const put = vi.spyOn(db, 'put').mockRejectedValue(new Error('unavailable'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => writeCloud({ ...EMPTY, region: 'retained' })).not.toThrow();
    await expect(flushCloudSettings()).rejects.toThrow('unavailable');
    expect(readCloud().region).toBe('retained');
    setItem.mockRestore();
    put.mockRestore();
    await flushCloudSettings();
    expect(await db.get('preferences', 'cloud')).toMatchObject({ value: { region: 'retained' } });
  });

  it('ignores a malformed database record and an empty store', async () => {
    const db = await openSpiderDb();
    await db.put('preferences', { id: 'cloud', updatedAt: 1, value: [] });
    await restoreCloud();
    expect(readCloud()).toEqual(EMPTY);
    resetCloudSettings();
    await restoreCloud();
    expect(readCloud()).toEqual(EMPTY);
  });

  it('does not replace edits made while a slow database is opening', async () => {
    const db = await openSpiderDb();
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.spyOn(db, 'get').mockReturnValue(pending as ReturnType<typeof db.get>);
    vi.useFakeTimers();
    const restoring = restoreCloud();
    await vi.advanceTimersByTimeAsync(1500);
    await restoring;
    vi.useRealTimers();
    writeCloud({ ...EMPTY, region: 'typed' });
    release({ id: 'cloud', updatedAt: Date.now() + 10_000, value: { ...EMPTY, region: 'late' } });
    await flushCloudSettings();
    expect(readCloud().region).toBe('typed');
  });

  it('ignores an old restoration after its cache has been reset', async () => {
    const db = await openSpiderDb();
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.spyOn(db, 'get').mockReturnValue(pending as ReturnType<typeof db.get>);
    const restoring = restoreCloud();
    resetCloudSettings();
    release({ id: 'cloud', updatedAt: 1, value: { ...EMPTY, region: 'late' } });
    await restoring;
    expect(readCloud()).toEqual(EMPTY);
  });
});
