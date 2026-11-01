import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openSpiderDb, resetSpiderDb } from '../../src/client/journal/db.js';
import {
  flushWorld,
  installWorldStore,
  onRestore,
  pendingNow,
  resetWorldStore,
  restoreWorld,
  setPending,
  writesDone,
} from '../../src/client/worldStore.js';
import { localDate } from '../../src/shared/dates.js';
import { SimSession } from '../../src/shared/sim/session.js';
import { captureBody, type WorldRecord } from '../../src/shared/sim/snapshot.js';
import { Terrain } from '../../src/shared/terrain.js';

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
    const note = await restoreWorld(session);
    expect(note.unreadable).toBe(false);
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
    expect(note).toMatchObject({ restored: false, unreadable: false, cause: null });
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
    expect(note).toMatchObject({ restored: false, unreadable: true, cause: 'malformed' });
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
    session.spider.root.position.x += 0.4;
    flushWorld('interval');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(4);
  });

  it('renews its own lease while standing still', async () => {
    const session = new SimSession(2);
    await restoreWorld(session);
    installWorldStore(session);
    session.spider.root.position.x += 0.2;
    flushWorld('poke');
    await writesDone();
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '') as WorldRecord;
    raw.leaseUntil = Date.now() + 500;
    localStorage.setItem(KEY, JSON.stringify(raw));
    await put(raw);
    flushWorld('interval');
    await writesDone();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '').seq).toBe(raw.seq + 1);
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
