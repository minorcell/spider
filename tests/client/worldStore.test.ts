import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openSpiderDb, resetSpiderDb } from '../../src/client/journal/db.js';
import {
  flushSoon,
  flushWorld,
  installWorldStore,
  onRestore,
  pendingNow,
  prefer,
  resetWorldStore,
  restoreWorld,
  setPending,
  writesDone,
} from '../../src/client/worldStore.js';
import { localDate } from '../../src/shared/dates.js';
import { SimSession } from '../../src/shared/sim/session.js';
import { captureBody, type WorldRecord } from '../../src/shared/sim/snapshot.js';
import { Terrain } from '../../src/shared/terrain.js';
import type { SnapshotStore } from '../../src/client/journal/store.js';

const gate = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'hang' | 'reject' }));

vi.mock('../../src/client/journal/db.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/client/journal/db.js')>(
    '../../src/client/journal/db.js',
  );
  return {
    ...actual,
    openSpiderDb: () => {
      if (gate.mode === 'hang') return new Promise(() => {});
      if (gate.mode === 'reject') return Promise.reject(new Error('closed'));
      return actual.openSpiderDb();
    },
  };
});

const KEY = 'p5-art.world';
const LEASE = 'p5-art.world.lease';

function stamp(session: SimSession, over: Partial<WorldRecord> = {}): WorldRecord {
  const body = captureBody(session, null);
  return {
    ...body,
    id: 'current',
    format: 1,
    savedAt: Date.now(),
    day: localDate(new Date()),
    owner: 'other',
    seq: 1,
    leaseUntil: Date.now() + 60_000,
    ...over,
  };
}

async function put(record: WorldRecord): Promise<void> {
  const db = await openSpiderDb();
  await db.put('snapshots', record);
}

interface MemoryStore extends SnapshotStore {
  value: unknown;
  failRead: boolean;
  failWrite: boolean;
  hangRead: boolean;
  calls: string[];
}

function memoryStore(value: unknown = null): MemoryStore {
  const store: MemoryStore = {
    value,
    failRead: false,
    failWrite: false,
    hangRead: false,
    calls: [],
    readSnapshot() {
      store.calls.push('read');
      if (store.hangRead) return new Promise(() => {});
      if (store.failRead) return Promise.reject(new Error('read'));
      return Promise.resolve(store.value);
    },
    putSnapshot(record) {
      store.calls.push('put');
      if (store.failWrite) return Promise.reject(new Error('write'));
      store.value = record;
      return Promise.resolve();
    },
    removeSnapshot() {
      store.calls.push('remove');
      store.value = null;
      return Promise.resolve();
    },
    sweepSnapshots() {
      store.calls.push('sweep');
      return Promise.resolve();
    },
  };
  return store;
}

beforeEach(async () => {
  gate.mode = 'ok';
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  resetWorldStore();
  await resetSpiderDb();
});

describe('restoreWorld', () => {
  it('adopts the newer buffer and copies it into the database', async () => {
    const live = new SimSession(3);
    const saved = new SimSession(9);
    saved.spider.root.position.set(4, saved.spider.root.position.y, 2);
    const record = stamp(saved, { seq: 4, pending: { text: '还在', tool: null } });
    localStorage.setItem(KEY, JSON.stringify(record));
    await put(stamp(live, { seq: 1 }));
    const session = new SimSession(1);
    const note = await restoreWorld(session);
    expect(note.restored).toBe(true);
    expect(note.pendingText).toBe('还在');
    expect(session.world.terrain.seed).toBe(saved.world.terrain.seed);
    expect(session.spider.root.position.x).toBeCloseTo(4);
    const db = await openSpiderDb();
    const stored = await db.get('snapshots', 'current');
    expect(stored?.seq).toBe(4);
  });

  it('drops a broken buffer and keeps a good database copy', async () => {
    const saved = new SimSession(4);
    await put(stamp(saved, { seq: 2 }));
    localStorage.setItem(KEY, '{');
    const session = new SimSession(1);
    await restoreWorld(session);
    expect(session.world.terrain.seed).toBe(saved.world.terrain.seed);
    expect(localStorage.getItem(KEY)).toContain('"seq":2');
  });

  it('starts a new island when the snapshot is too old', async () => {
    const saved = new SimSession(4);
    const record = stamp(saved, { day: '2020-01-01' });
    localStorage.setItem(KEY, JSON.stringify(record));
    await put(record);
    const session = new SimSession(8);
    const born = session.world.terrain.seed;
    const note = await restoreWorld(session);
    expect(note).toMatchObject({ restored: false, cause: null });
    expect(session.world.terrain.seed).toBe(born);
    expect(localStorage.getItem(KEY)).toBeNull();
    const db = await openSpiderDb();
    expect(await db.get('snapshots', 'current')).toBeUndefined();
  });

  it('does not overwrite a snapshot from a newer page', async () => {
    const record = { ...stamp(new SimSession(2)), format: 2 };
    localStorage.setItem(KEY, JSON.stringify(record));
    const session = new SimSession(6);
    const born = session.world.terrain.seed;
    const note = await restoreWorld(session);
    expect(note.cause).toBe('format');
    expect(session.world.terrain.seed).toBe(born);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').format).toBe(2);
    installWorldStore(session);
    session.spider.root.position.x += 1;
    flushWorld('poke');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').format).toBe(2);
  });

  it('says the place was unreadable when nothing valid remains', async () => {
    localStorage.setItem(KEY, '{');
    const note = await restoreWorld(new SimSession(1));
    expect(note).toMatchObject({ restored: false, cause: 'malformed' });
  });

  it('still starts when the database cannot be opened', async () => {
    gate.mode = 'reject';
    const note = await restoreWorld(new SimSession(1));
    expect(note.restored).toBe(false);
    expect(note.cause).toBeNull();
  });

  it('does not wait on a database another tab has locked', async () => {
    vi.useFakeTimers();
    gate.mode = 'hang';
    const saved = new SimSession(5);
    const record = stamp(saved, { seq: 3, pending: { text: '锁着', tool: null } });
    localStorage.setItem(KEY, JSON.stringify(record));
    const session = new SimSession(1);
    const pending = restoreWorld(session);
    await vi.advanceTimersByTimeAsync(1500);
    const note = await pending;
    expect(note.pendingText).toBe('锁着');
    expect(session.world.terrain.seed).toBe(saved.world.terrain.seed);
    vi.useRealTimers();
  });
});

describe('flushWorld', () => {
  it('serializes overlapping writes and keeps the latest body', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);

    let release!: () => void;
    let enter!: () => void;
    const firstPut = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalPut = store.putSnapshot.bind(store);
    let puts = 0;
    store.putSnapshot = async (record) => {
      puts += 1;
      if (puts === 1) {
        enter();
        await writeGate;
      }
      await originalPut(record);
    };

    session.spider.root.position.x = 0.3;
    flushWorld('poke');
    session.spider.root.position.x = 0.6;
    flushWorld('poke');
    await firstPut;
    release();
    await writesDone();

    expect(puts).toBe(2);
    expect(store.value).toMatchObject({ seq: 2, spider: { position: { x: 0.6 } } });
  });

  it('continues after a visible-tab reconciliation failure', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    store.value = stamp(new SimSession(8), { seq: 2, owner: 'other' });
    const adopt = vi.spyOn(session, 'adopt').mockImplementation(() => {
      throw new Error('adopt failed');
    });
    installWorldStore(session, store);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    expect(adopt).toHaveBeenCalled();
  });

  it('does nothing until the store is installed', async () => {
    const record = stamp(new SimSession(2), { seq: 6 });
    localStorage.setItem(KEY, JSON.stringify(record));
    flushWorld('hide');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(6);
  });

  it('writes a move, and ignores a small apple tick until the page hides', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    session.spider.root.position.x += 0.2;
    flushWorld('poke');
    await writesDone();
    const first = JSON.parse(localStorage.getItem(KEY) ?? '').seq as number;
    session.world.appleIn = (session.world.appleIn ?? 24) - 1;
    flushWorld('interval');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(first);
    flushWorld('hide');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(first + 1);

    session.spider.root.position.x += 0.1;
    flushWorld('interval');
    await writesDone();
    session.spider.yaw += 0.05;
    flushWorld('poke');
    await writesDone();
    session.world.sprouts = (session.world.sprouts ?? 0) + 1;
    flushWorld('poke');
    await writesDone();
    session.world.seed = 99;
    session.world.terrain = new Terrain(99);
    flushWorld('poke');
    await writesDone();
    setPending({ text: '带上苹果', tool: null });
    flushWorld('poke');
    await writesDone();
    const grass = session.world.entities.find((entity) => entity.kind === 'grass');
    grass!.footprint = { kind: 'box', hx: 1, hz: 1 };
    flushWorld('poke');
    await writesDone();
    const moved = JSON.parse(localStorage.getItem(KEY) ?? '').seq as number;
    flushWorld('poke');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(moved);
    grass!.footprint = { kind: 'box', hx: 2, hz: 1 };
    flushWorld('poke');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(moved + 1);
    session.world.entities.pop();
    flushWorld('poke');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(moved + 2);
  });

  it('lets this tab keep its lease across a reload', async () => {
    sessionStorage.setItem('p5-art.world.owner', 'tab-a');
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    session.spider.root.position.x += 0.2;
    flushWorld('poke');
    await writesDone();
    const seq = JSON.parse(localStorage.getItem(KEY) ?? '').seq as number;
    resetWorldStore();
    sessionStorage.setItem('p5-art.world.owner', 'tab-a');
    const again = new SimSession(2);
    await restoreWorld(again);
    installWorldStore(again);
    again.spider.root.position.x += 0.2;
    flushWorld('poke');
    await writesDone();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '');
    expect(stored.owner).toBe('tab-a');
    expect(stored.seq).toBe(seq + 1);
  });

  it('waits out another live tab', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    await put(stamp(session, { seq: 8, owner: 'other', leaseUntil: Date.now() + 60_000 }));
    localStorage.setItem(
      KEY,
      JSON.stringify(stamp(session, { seq: 8, owner: 'other', leaseUntil: Date.now() + 60_000 })),
    );
    localStorage.setItem(LEASE, JSON.stringify({ owner: 'other', until: Date.now() + 60_000 }));
    session.spider.root.position.x += 0.4;
    flushWorld('poke');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(8);
  });

  it('takes over once the other lease is over', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    const stale = stamp(session, { seq: 3, owner: 'other', leaseUntil: Date.now() - 10 });
    await put(stale);
    localStorage.setItem(KEY, JSON.stringify(stale));
    localStorage.setItem(LEASE, JSON.stringify({ owner: 'other', until: Date.now() - 10 }));
    session.spider.root.position.x += 0.4;
    flushWorld('interval');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(4);
  });

  it('renews the lease key without rewriting the snapshot', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    installWorldStore(session, store);
    session.spider.root.position.x += 0.2;
    flushWorld('poke');
    await writesDone();
    const seq = (JSON.parse(localStorage.getItem(KEY) ?? '') as WorldRecord).seq;
    const first = JSON.parse(localStorage.getItem(LEASE) ?? '') as { owner: string; until: number };
    expect(first.owner).toBe((JSON.parse(localStorage.getItem(KEY) ?? '') as WorldRecord).owner);

    await vi.advanceTimersByTimeAsync(20_000);
    await writesDone();
    const next = JSON.parse(localStorage.getItem(LEASE) ?? '') as { owner: string; until: number };
    expect(next.until).toBeGreaterThan(first.until);
    expect((JSON.parse(localStorage.getItem(KEY) ?? '') as WorldRecord).seq).toBe(seq);
    vi.useRealTimers();
  });

  it('puts the buffer down before IndexedDB answers', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    const db = await openSpiderDb();
    let release: (value: unknown) => void = () => {};
    const get = vi.spyOn(db, 'get').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    session.spider.root.position.x += 0.3;
    flushWorld('hide');
    expect(localStorage.getItem(KEY)).toContain('"seq":1');
    // The write reaches the pending read after its own microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(undefined);
    await writesDone();
    get.mockRestore();
  });

  it('keeps the database copy when the buffer cannot be written', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    session.spider.root.position.x += 0.3;
    flushWorld('poke');
    await writesDone();
    setItem.mockRestore();
    const db = await openSpiderDb();
    expect((await db.get('snapshots', 'current'))?.seq).toBe(1);
  });

  it('keeps the buffer when the database rejects the write', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    const db = await openSpiderDb();
    const putSnap = vi.spyOn(db, 'put').mockRejectedValue(new Error('full'));
    session.spider.root.position.x += 0.3;
    flushWorld('poke');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(1);
    putSnap.mockRestore();
  });

  it('swallows a failure of both stores', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    const db = await openSpiderDb();
    const putSnap = vi.spyOn(db, 'put').mockRejectedValue(new Error('full'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    session.spider.root.position.x += 0.3;
    flushWorld('poke');
    await expect(writesDone()).resolves.toBeUndefined();
    setItem.mockRestore();
    putSnap.mockRestore();
  });

  it('adopts a newer save when the tab becomes visible again', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    const heard: string[] = [];
    onRestore((note) => {
      if (note.pendingText) heard.push(note.pendingText);
    });
    installWorldStore(session);
    const other = new SimSession(11);
    const record = stamp(other, { seq: 5, pending: { text: '换岛', tool: 'walk' } });
    await put(record);
    localStorage.setItem(KEY, JSON.stringify(record));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    expect(session.world.terrain.seed).toBe(other.world.terrain.seed);
    expect(heard).toEqual(['换岛']);
    expect(pendingNow()?.text).toBe('换岛');
  });

  it('stays quiet while the document is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    session.spider.root.position.x += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(localStorage.getItem(KEY)).toBeNull();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('leaves a blocked buffer alone', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const note = await restoreWorld(new SimSession(1));
    expect(note.restored).toBe(false);
    getItem.mockRestore();
  });

  it('still restores when mirroring the buffer fails', async () => {
    const record = stamp(new SimSession(4), { seq: 2 });
    await put(record);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const note = await restoreWorld(new SimSession(1));
    setItem.mockRestore();
    expect(note.restored).toBe(true);
  });

  it('mints an owner when session storage is blocked', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    getItem.mockRestore();
    session.spider.root.position.x += 0.2;
    flushWorld('poke');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').owner).toEqual(expect.any(String));
  });
});

describe('injected snapshot store', () => {
  it('reads, writes, and sweeps through the given store', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    expect(await restoreWorld(session, new Date(), store)).toMatchObject({ restored: false });
    installWorldStore(session, store);
    session.spider.root.position.x += 0.3;
    flushWorld('poke');
    await writesDone();
    expect(store.value).toMatchObject({ id: 'current' });
    expect(store.calls).toContain('put');
    expect(store.calls).toContain('sweep');
  });

  it('reconciles a deferred store and adopts a newer save', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    const session = new SimSession(2);
    const pending = restoreWorld(session, new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    const note = await pending;
    expect(note.restored).toBe(false);
    vi.useRealTimers();

    store.hangRead = false;
    const other = new SimSession(11);
    store.value = stamp(other, { seq: 5, pending: { text: '换岛', tool: null } });
    const heard: string[] = [];
    onRestore((arrived) => {
      if (arrived.pendingText) heard.push(arrived.pendingText);
    });
    installWorldStore(session, store);
    await writesDone();
    expect(session.world.seed).toBe(other.world.seed);
    expect(heard).toEqual(['换岛']);
    expect(pendingNow()?.text).toBe('换岛');
  });

  it('falls back when the deferred store cannot be read', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    const session = new SimSession(2);
    const pending = restoreWorld(session, new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    vi.useRealTimers();
    store.hangRead = false;
    store.failRead = true;
    installWorldStore(session, store);
    await writesDone();
    expect(store.calls.filter((call) => call === 'read').length).toBeGreaterThan(1);
  });

  it('stops writing when the deferred store is a newer format', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    const session = new SimSession(2);
    const pending = restoreWorld(session, new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    vi.useRealTimers();
    store.hangRead = false;
    store.value = { format: 2 };
    installWorldStore(session, store);
    await writesDone();
    session.spider.root.position.x += 0.5;
    flushWorld('poke');
    await writesDone();
    expect(store.calls).not.toContain('put');
  });

  it('stops when the buffer is a newer format', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    localStorage.setItem(KEY, JSON.stringify({ format: 2 }));
    session.spider.root.position.x += 0.5;
    flushWorld('poke');
    await writesDone();
    expect(store.calls).not.toContain('put');
  });

  it('stops when the store is a newer format during a write', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    store.value = { format: 2 };
    session.spider.root.position.x += 0.5;
    flushWorld('poke');
    await writesDone();
    expect(store.calls).not.toContain('put');
  });

  it('still writes the store when the hide buffer is full', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    session.spider.root.position.x += 0.2;
    flushWorld('hide');
    await writesDone();
    setItem.mockRestore();
    expect(store.calls).toContain('put');
    expect((store.value as WorldRecord).seq).toBe(1);
  });

  it('drops a malformed buffer without waiting for a locked store', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    localStorage.setItem(KEY, '{');
    const pending = restoreWorld(new SimSession(1), new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    const note = await pending;
    vi.useRealTimers();
    expect(note).toMatchObject({ cause: 'malformed' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('starts when the injected store rejects', async () => {
    const store = memoryStore();
    store.failRead = true;
    const note = await restoreWorld(new SimSession(1), new Date(), store);
    expect(note).toMatchObject({ restored: false, cause: null });
  });

  it('stops when a visible tab sees a newer format', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    store.value = { format: 2 };
    localStorage.setItem(KEY, JSON.stringify({ format: 2 }));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    session.spider.root.position.x += 0.5;
    flushWorld('poke');
    await writesDone();
    expect(store.calls).not.toContain('put');
  });

  it('clears the interval when the page goes hidden', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    installWorldStore(session, store);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    // A second hidden tick finds no timer to clear.
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('prefers the later record, or the one that exists', () => {
    const a = stamp(new SimSession(1), { seq: 1 });
    const b = stamp(new SimSession(2), { seq: 2 });
    expect(prefer(b, a)).toBe(b);
    expect(prefer(a, b)).toBe(b);
    expect(prefer(a, undefined)).toBe(a);
    expect(prefer(undefined, b)).toBe(b);
    expect(prefer()).toBeUndefined();
  });

  it('uses the store record when the buffer is empty', async () => {
    const store = memoryStore(stamp(new SimSession(3), { seq: 2 }));
    const session = new SimSession(1);
    await restoreWorld(session, new Date(), store);
    localStorage.removeItem(KEY);
    session.spider.root.position.x += 0.5;
    flushWorld('poke');
    await writesDone();
    expect(store.calls).toContain('read');
  });

  it('saves on the interval and stops the timer when hidden', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    installWorldStore(session, store);
    session.spider.root.position.x += 0.2;
    await vi.advanceTimersByTimeAsync(10_000);
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBeGreaterThan(0);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('stages a hide snapshot while the store is deferred', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    const session = new SimSession(2);
    const pending = restoreWorld(session, new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    vi.useRealTimers();

    store.hangRead = false;
    installWorldStore(session, store);
    session.spider.root.position.x += 0.3;
    flushWorld('hide');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(1);
  });

  it('reconciles an empty store without adopting', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    const session = new SimSession(2);
    const born = session.world.seed;
    const pending = restoreWorld(session, new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    vi.useRealTimers();
    store.hangRead = false;
    installWorldStore(session, store);
    await writesDone();
    expect(session.world.seed).toBe(born);
  });

  it('ignores a deferred store that is no newer', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    const local = stamp(new SimSession(4), { seq: 3 });
    localStorage.setItem(KEY, JSON.stringify(local));
    const session = new SimSession(2);
    const pending = restoreWorld(session, new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    vi.useRealTimers();
    store.hangRead = false;
    store.value = stamp(new SimSession(5), { seq: 2 });
    installWorldStore(session, store);
    await writesDone();
    expect(session.world.seed).toBe(local.seed);
  });

  it('adopts a deferred save without a pending sentence', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    store.hangRead = true;
    const session = new SimSession(2);
    const pending = restoreWorld(session, new Date(), store);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    vi.useRealTimers();
    store.hangRead = false;
    const other = new SimSession(13);
    store.value = stamp(other, { seq: 5, pending: null });
    const heard: Array<string | null> = [];
    onRestore((arrived) => heard.push(arrived.pendingText));
    installWorldStore(session, store);
    await writesDone();
    expect(session.world.seed).toBe(other.world.seed);
    expect(heard).toEqual([null]);
    expect(pendingNow()).toBeNull();
  });

  it('leaves the page alone when a visible tab finds nothing newer', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    localStorage.removeItem(KEY);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    expect(store.value).toBeNull();
  });

  it('ignores a visible record this tab wrote', async () => {
    sessionStorage.setItem('p5-art.world.owner', 'tab-a');
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    const own = stamp(new SimSession(5), {
      seq: 9,
      owner: 'tab-a',
      pending: { text: '自己', tool: null },
    });
    store.value = own;
    localStorage.setItem(KEY, JSON.stringify(own));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    expect(pendingNow()).toBeNull();
  });

  it('ignores a visible record no newer than the one held', async () => {
    const store = memoryStore(stamp(new SimSession(3), { seq: 5 }));
    const session = new SimSession(1);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    store.value = stamp(new SimSession(4), { seq: 4 });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    expect(session.world.seed).toBe(3);
  });

  it('adopts a visible save without a pending sentence', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    const other = new SimSession(13);
    const record = stamp(other, { seq: 5, pending: null });
    store.value = record;
    localStorage.setItem(KEY, JSON.stringify(record));
    const heard: Array<string | null> = [];
    onRestore((arrived) => heard.push(arrived.pendingText));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await writesDone();
    expect(session.world.seed).toBe(other.world.seed);
    expect(heard).toEqual([null]);
  });

  it('removes a malformed database record when the buffer is good', async () => {
    const local = stamp(new SimSession(2), { seq: 2 });
    localStorage.setItem(KEY, JSON.stringify(local));
    const db = await openSpiderDb();
    await db.put('snapshots', { id: 'current', format: 1 } as WorldRecord);
    const note = await restoreWorld(new SimSession(1));
    expect(note.restored).toBe(true);
    const after = await openSpiderDb();
    expect(await after.get('snapshots', 'current')).toMatchObject({ seq: 2 });
  });
});

describe('write cadence and leases', () => {
  it('coalesces quick pokes into one write', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    session.spider.root.position.x += 0.2;
    flushSoon('poke');
    session.spider.root.position.x += 0.2;
    flushSoon('poke');
    await vi.advanceTimersByTimeAsync(399);
    expect(store.calls).not.toContain('put');
    await vi.advanceTimersByTimeAsync(1);
    await writesDone();
    expect(store.calls.filter((call) => call === 'put')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('cancels a pending poke when an immediate flush lands', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    session.spider.root.position.x += 0.2;
    flushSoon('poke');
    flushWorld('hide');
    await writesDone();
    expect(store.calls.filter((call) => call === 'put')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    await writesDone();
    expect(store.calls.filter((call) => call === 'put')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('drops the poke timer and the lease on reset', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    flushSoon('poke');
    localStorage.setItem(LEASE, JSON.stringify({ owner: 'tab', until: Date.now() + 60_000 }));
    resetWorldStore();
    expect(vi.getTimerCount()).toBe(0);
    expect(localStorage.getItem(LEASE)).toBeNull();
    vi.useRealTimers();
  });

  it('falls back to the snapshot lease when the key is missing', async () => {
    sessionStorage.setItem('p5-art.world.owner', 'tab-a');
    const store = memoryStore();
    const saved = stamp(new SimSession(4), {
      seq: 2,
      owner: 'tab-a',
      leaseUntil: Date.now() + 60_000,
    });
    store.value = saved;
    const session = new SimSession(1);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    localStorage.removeItem(LEASE);
    session.spider.root.position.x += 0.3;
    flushWorld('poke');
    await writesDone();
    expect(store.calls).toContain('put');
  });

  it('writes when neither a lease nor a record exists', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    localStorage.removeItem(LEASE);
    session.spider.root.position.x += 0.3;
    flushWorld('poke');
    await writesDone();
    expect(store.calls).toContain('put');
  });

  it('ignores an unreadable lease key', async () => {
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    for (const raw of ['{', '{"owner":4,"until":1}', '{"owner":"x","until":"y"}']) {
      localStorage.setItem(LEASE, raw);
      session.spider.root.position.x += 0.3;
      flushWorld('poke');
      await writesDone();
    }
    expect(store.calls.filter((call) => call === 'put')).toHaveLength(3);
  });

  it('leaves a missing or foreign lease alone while idle', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const session = new SimSession(2);
    await restoreWorld(session, new Date(), store);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    installWorldStore(session, store);
    localStorage.removeItem(LEASE);
    await vi.advanceTimersByTimeAsync(10_000);
    await writesDone();
    expect(localStorage.getItem(LEASE)).toBeNull();

    localStorage.setItem(LEASE, JSON.stringify({ owner: 'other', until: Date.now() + 60_000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    await writesDone();
    expect((JSON.parse(localStorage.getItem(LEASE) ?? '') as { owner: string }).owner).toBe(
      'other',
    );
    vi.useRealTimers();
  });

  it('keeps an existing lease and stages with the buffer lease', async () => {
    sessionStorage.setItem('p5-art.world.owner', 'tab-a');
    const store = memoryStore();
    const saved = stamp(new SimSession(4), {
      seq: 2,
      owner: 'tab-a',
      leaseUntil: Date.now() + 60_000,
    });
    store.value = saved;
    localStorage.setItem(LEASE, JSON.stringify({ owner: 'other', until: saved.leaseUntil }));
    const session = new SimSession(1);
    await restoreWorld(session, new Date(), store);
    installWorldStore(session, store);
    expect((JSON.parse(localStorage.getItem(LEASE) ?? '') as { owner: string }).owner).toBe(
      'other',
    );
    localStorage.removeItem(LEASE);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    session.spider.root.position.x += 0.3;
    flushWorld('hide');
    await writesDone();
    expect((JSON.parse(localStorage.getItem(KEY) ?? '') as WorldRecord).seq).toBe(3);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
});
