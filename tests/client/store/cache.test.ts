import { describe, expect, it, vi } from 'vitest';
import {
  PersistentCache,
  type CacheAdapter,
  type RecoveryBuffer,
} from '../../../src/client/store/cache.js';

interface RecordValue {
  seed: number;
  position: { x: number };
}

function record(seed: number): RecordValue {
  return { seed, position: { x: seed } };
}

function fixture() {
  let persisted: unknown = null;
  let recovered: unknown = null;
  const adapter: CacheAdapter<RecordValue> = {
    read: vi.fn(async () => persisted),
    write: vi.fn(async (value) => {
      persisted = value;
    }),
  };
  const recovery: RecoveryBuffer<RecordValue> = {
    read: vi.fn(() => recovered),
    write: vi.fn((value) => {
      recovered = value;
      return true;
    }),
  };
  return {
    adapter,
    recovery,
    cache: new PersistentCache(adapter, recovery),
    setPersistent(value: unknown) {
      persisted = value;
    },
    setRecovery(value: unknown) {
      recovered = value;
    },
  };
}

describe('PersistentCache', () => {
  it('reads raw storage without replacing the memory snapshot', async () => {
    const { cache, setPersistent, setRecovery } = fixture();
    setPersistent({ format: 'future' });
    setRecovery('unparsed recovery');
    expect(cache.peek()).toBeNull();
    expect(cache.readRecovery()).toBe('unparsed recovery');
    await expect(cache.readPersistent()).resolves.toEqual({ format: 'future' });
    expect(cache.peek()).toBeNull();
  });

  it('hydrates a clean snapshot without scheduling a write', async () => {
    const { cache, adapter, recovery } = fixture();
    const value = record(1);
    cache.hydrate(value);
    value.position.x = 10;
    const snapshot = cache.peek();
    snapshot!.position.x = 20;
    expect(cache.peek()).toEqual(record(1));
    expect(cache.pending()).toBe(false);
    await cache.flush();
    expect(adapter.write).not.toHaveBeenCalled();
    expect(recovery.write).not.toHaveBeenCalled();
    cache.hydrate(null);
    expect(cache.peek()).toBeNull();
  });

  it('stages a recoverable snapshot synchronously before any persistent work', async () => {
    const { cache, adapter } = fixture();
    const value = record(2);
    expect(cache.stage(value)).toBe(true);
    value.position.x = 20;
    expect(cache.peek()).toEqual(record(2));
    expect(cache.readRecovery()).toEqual(record(2));
    expect(cache.pending()).toBe(true);
    expect(adapter.write).not.toHaveBeenCalled();
    await cache.flush();
    await expect(cache.readPersistent()).resolves.toEqual(record(2));
    expect(cache.pending()).toBe(false);
  });

  it('keeps staged changes when a later hydration arrives', async () => {
    const { cache } = fixture();
    cache.stage(record(3));
    cache.hydrate(record(1));
    cache.hydrate(null);
    expect(cache.peek()).toEqual(record(3));
    expect(cache.pending()).toBe(true);
    await cache.flush();
    await expect(cache.readPersistent()).resolves.toEqual(record(3));
    cache.hydrate(record(4));
    expect(cache.peek()).toEqual(record(4));
  });

  it('coalesces changes staged before the persistent writer starts', async () => {
    const { cache, adapter } = fixture();
    cache.stage(record(1));
    const writing = cache.flush();
    cache.stage(record(2));
    cache.stage(record(3));
    await writing;
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(adapter.write).toHaveBeenCalledWith(record(3));
    expect(cache.pending()).toBe(false);
  });

  it('drains the latest revision without regressing recovery during an older write', async () => {
    const { cache, adapter, recovery } = fixture();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let concurrent = 0;
    const original = adapter.write;
    adapter.write = vi.fn(async (value) => {
      active += 1;
      concurrent = Math.max(concurrent, active);
      if (value.seed === 1) {
        started();
        await hold;
      }
      await original(value);
      active -= 1;
    });

    cache.stage(record(1));
    const first = cache.flush();
    await entered;
    cache.stage(record(2));
    cache.hydrate(record(0));
    const second = cache.flush();
    cache.stage(record(3));
    expect(cache.readRecovery()).toEqual(record(3));
    release();
    await Promise.all([first, second]);
    expect(concurrent).toBe(1);
    expect(adapter.write).toHaveBeenNthCalledWith(1, record(1));
    expect(adapter.write).toHaveBeenNthCalledWith(2, record(3));
    expect(adapter.write).toHaveBeenCalledTimes(2);
    expect(recovery.write).toHaveBeenCalledTimes(3);
    expect(cache.readRecovery()).toEqual(record(3));
    await expect(cache.readPersistent()).resolves.toEqual(record(3));
    expect(cache.peek()).toEqual(record(3));
    expect(cache.pending()).toBe(false);
  });

  it('keeps a failed revision dirty and retries the newest staged value', async () => {
    const { cache, adapter } = fixture();
    vi.mocked(adapter.write).mockRejectedValueOnce(new Error('quota'));
    cache.stage(record(1));
    await expect(cache.flush()).rejects.toThrow('quota');
    expect(cache.pending()).toBe(true);
    expect(cache.readRecovery()).toEqual(record(1));
    cache.hydrate(record(0));
    expect(cache.peek()).toEqual(record(1));
    cache.stage(record(2));
    await cache.flush();
    await expect(cache.readPersistent()).resolves.toEqual(record(2));
    expect(cache.pending()).toBe(false);
  });

  it('allows a queued flush to retry after the preceding flush fails', async () => {
    const { cache, adapter } = fixture();
    vi.mocked(adapter.write).mockRejectedValueOnce(new Error('unavailable'));
    cache.stage(record(1));
    const first = cache.flush();
    const second = cache.flush();
    await expect(first).rejects.toThrow('unavailable');
    await second;
    expect(adapter.write).toHaveBeenCalledTimes(2);
    expect(cache.pending()).toBe(false);
  });

  it.each(['refuses', 'throws'] as const)(
    'keeps the memory value when the recovery buffer %s',
    async (failure) => {
      const { cache, recovery } = fixture();
      vi.mocked(recovery.write).mockImplementation(() => {
        if (failure === 'throws') throw new Error('denied');
        return false;
      });
      expect(cache.stage(record(7))).toBe(false);
      expect(cache.peek()).toEqual(record(7));
      expect(cache.pending()).toBe(true);
      await cache.flush();
      await expect(cache.readPersistent()).resolves.toEqual(record(7));
      expect(cache.pending()).toBe(false);
    },
  );

  it('isolates cached values from storage adapter mutations', async () => {
    const { cache, adapter, recovery } = fixture();
    vi.mocked(recovery.write).mockImplementation((value) => {
      value.position.x = 100;
      return true;
    });
    vi.mocked(adapter.write).mockImplementation(async (value) => {
      value.position.x = 200;
    });
    cache.stage(record(1));
    await cache.flush();
    expect(cache.peek()).toEqual(record(1));
  });
});
