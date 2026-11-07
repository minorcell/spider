import { localDate } from '../shared/dates.js';
import type { SnapshotStore } from './journal/store.js';
import { PersistentCache } from './store/cache.js';
import {
  applyBody,
  captureBody,
  chooseRecord,
  classify,
  newer,
  type Classify,
  type Restorable,
  type SimBody,
  type WorldRecord,
} from '../shared/sim/snapshot.js';
import { Terrain } from '../shared/terrain.js';
import {
  bufferPut,
  forgetBuffer,
  forgetLease,
  forgetOwner,
  leaseOf,
  mayWrite,
  pageOwner,
  readBuffer,
  readLease,
  setLease,
} from './world/storage.js';

const SAVE_MS = 10_000;
const LEASE_MS = 30_000;
const POKE_MS = 400;
const APPLE_DIRTY_S = 5;
const MOVE_M = 0.05;
const YAW_M = 0.02;
const OPEN_MS = 1500;

export interface BootNote {
  restored: boolean;
  cause: 'format' | 'malformed' | null;
  pendingText: string | null;
}

type Reason = 'interval' | 'hide' | 'poke';

let installed = false;
let readonly = false;
let dbDeferred = false;
let owner = '';
let seenSeq = 0;
let lastBody: SimBody | null = null;
let pending: SimBody['pending'] = null;
let timer: ReturnType<typeof setInterval> | undefined;
let pokeTimer: ReturnType<typeof setTimeout> | undefined;
let sessionRef: Restorable | null = null;
let listener: ((note: BootNote) => void) | null = null;
let onVis: (() => void) | null = null;
let providedStore: SnapshotStore | null = null;
let storePromise: Promise<SnapshotStore> | null = null;
let workTail: Promise<void> = Promise.resolve();
let writeRevision = 0;
let stagedRevision = 0;
let cache = worldCache();
let terrainFor: ((seed: number) => Promise<Terrain>) | null = null;
let cloudLock = false;
let onWritten: ((reason: Reason) => void) | null = null;

export function setCloudLock(locked: boolean): void {
  cloudLock = locked;
}

export function onWorldWritten(listen: ((reason: Reason) => void) | null): void {
  onWritten = listen;
}

export function setWorldTerrainSource(source: ((seed: number) => Promise<Terrain>) | null): void {
  terrainFor = source;
}

function resolveStore(): Promise<SnapshotStore> {
  if (providedStore) return Promise.resolve(providedStore);
  storePromise ??= import('./journal/store.js').then((module) => module.dbSnapshotStore());
  return storePromise;
}

function worldCache(): PersistentCache<WorldRecord> {
  return new PersistentCache<WorldRecord>(
    {
      read: async () => (await resolveStore()).readSnapshot(),
      write: async (record) => {
        const store = await resolveStore();
        await store.putSnapshot(record);
        await store.sweepSnapshots(record.day);
      },
    },
    { read: readBuffer, write: bufferPut },
  );
}

function stageRecord(record: WorldRecord): boolean {
  const latest = classify(cache.readRecovery(), localDate(new Date()));
  if (latest.status === 'format') {
    readonly = true;
    return false;
  }
  if (
    latest.status === 'ok' &&
    (latest.record.seq > record.seq ||
      (latest.record.seq === record.seq && latest.record.savedAt > record.savedAt))
  ) {
    return false;
  }
  cache.stage(record);
  return true;
}

function touchLease(): void {
  const lease = readLease();
  if (!lease || lease.owner !== owner) return;
  const now = Date.now();
  if (lease.until - now > LEASE_MS / 2) return;
  setLease(owner, now + LEASE_MS);
}

export function setPending(next: SimBody['pending']): void {
  pending = next && next.text !== '' ? { text: next.text, tool: next.tool } : null;
}

export function pendingNow(): SimBody['pending'] {
  return pending;
}

export function onRestore(listen: (note: BootNote) => void): void {
  listener = listen;
}

export function flushWorld(reason: Reason): void {
  if (!installed || readonly || !sessionRef || cloudLock) return;
  if (pokeTimer) {
    clearTimeout(pokeTimer);
    pokeTimer = undefined;
  }
  enqueueWrite(reason);
}

export function flushSoon(reason: Reason): void {
  if (!installed || readonly || !sessionRef) return;
  if (pokeTimer) clearTimeout(pokeTimer);
  pokeTimer = setTimeout(() => {
    pokeTimer = undefined;
    flushWorld(reason);
  }, POKE_MS);
}

export function writesDone(): Promise<void> {
  return workTail;
}

export function resetWorldStore(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (pokeTimer) clearTimeout(pokeTimer);
  pokeTimer = undefined;
  if (onVis) document.removeEventListener('visibilitychange', onVis);
  onVis = null;
  installed = false;
  readonly = false;
  dbDeferred = false;
  owner = '';
  forgetOwner();
  forgetLease();
  seenSeq = 0;
  lastBody = null;
  pending = null;
  sessionRef = null;
  listener = null;
  providedStore = null;
  storePromise = null;
  terrainFor = null;
  cloudLock = false;
  onWritten = null;
  writeRevision = 0;
  stagedRevision = 0;
  cache = worldCache();
  workTail = Promise.resolve();
}

export async function restoreWorld(
  session: Restorable,
  now = new Date(),
  store?: SnapshotStore,
): Promise<BootNote> {
  if (store) providedStore = store;
  const today = localDate(now);
  const ls = classify(readBuffer(), today);
  const loaded = await loadIdb(today);
  dbDeferred = loaded.deferred;
  const idb = loaded.idb;
  const dbOpen = loaded.opened;
  if (ls.status === 'format' || idb.status === 'format') {
    readonly = true;
    return { restored: false, cause: 'format', pendingText: null };
  }
  await forget(ls, 'local', today);
  await forget(idb, 'idb', today);
  const chosen = chooseRecord(
    ls.status === 'ok' ? ls.record : null,
    idb.status === 'ok' ? idb.record : null,
    today,
  );
  if (!chosen) {
    const broken = ls.status === 'malformed' || idb.status === 'malformed';
    return {
      restored: false,
      cause: broken ? 'malformed' : null,
      pendingText: null,
    };
  }
  if (!readLease()) setLease(chosen.owner, chosen.leaseUntil);
  await adoptBody(session, strip(chosen));
  pending = chosen.pending;
  seenSeq = chosen.seq;
  lastBody = strip(chosen);
  cache.hydrate(chosen);
  if (dbOpen && !dbDeferred) await mirror(chosen, ls, idb);
  return {
    restored: true,
    cause: null,
    pendingText: chosen.pending?.text ?? null,
  };
}

export function installWorldStore(session: Restorable, store?: SnapshotStore): void {
  if (store) providedStore = store;
  sessionRef = session;
  installed = true;
  if (!owner) owner = pageOwner();
  if (readonly) return;
  if (!readLease()) setLease(owner, Date.now() + LEASE_MS);
  if (onVis) document.removeEventListener('visibilitychange', onVis);
  onVis = () => {
    if (document.visibilityState === 'hidden') {
      flushWorld('hide');
      if (timer) clearInterval(timer);
      timer = undefined;
      return;
    }
    enqueue(() => catchUp().then(() => arm()));
  };
  document.addEventListener('visibilitychange', onVis);
  if (dbDeferred) {
    enqueue(() => reconcile().then(() => arm()));
    return;
  }
  arm();
}

function enqueueWrite(reason: Reason): void {
  const previous = workTail;
  let finish!: () => void;
  const current = new Promise<void>((resolve) => {
    finish = resolve;
  });
  workTail = current;
  void write(reason, previous).then(finish, finish);
}

async function write(reason: Reason, previous: Promise<void>): Promise<void> {
  if (reason === 'interval') touchLease();
  const session = sessionRef as Restorable;
  const now = Date.now();
  const today = localDate(new Date(now));
  const body = captureBody(session, pending);
  const slack = reason === 'interval' ? APPLE_DIRTY_S : 0.05;
  const dirty =
    !lastBody ||
    (reason === 'hide'
      ? JSON.stringify(lastBody) !== JSON.stringify(body)
      : changed(lastBody, body, slack));
  const revision = ++writeRevision;

  const local = classify(readBuffer(), today);
  if (local.status === 'format') {
    readonly = true;
    return;
  }
  let localRec = local.status === 'ok' ? local.record : undefined;
  if (localRec && localRec.owner !== owner && localRec.seq > seenSeq && localRec.leaseUntil > now) {
    return;
  }

  let staged: WorldRecord | null = null;
  if (reason === 'hide' || dbDeferred) {
    const stagingLease = readLease() ?? leaseOf(localRec);
    if ((dirty || cache.pending()) && mayWrite(stagingLease, owner, now)) {
      const seq = Math.max(localRec?.seq ?? 0, seenSeq) + 1;
      staged = stamp(body, seq, now, today);
      if (!stageRecord(staged)) return;
      stagedRevision = revision;
      seenSeq = seq;
      lastBody = body;
    }
  }
  if (dbDeferred) {
    if (staged) onWritten?.(reason);
    return;
  }

  await previous;

  let idbRec: WorldRecord | undefined;
  try {
    const idb = classify(await readIdb(), today);
    if (idb.status === 'format') {
      readonly = true;
      return;
    }
    if (idb.status === 'ok') idbRec = idb.record;
  } catch {}

  if (revision < stagedRevision) return;
  const latest = classify(cache.readRecovery(), today);
  if (latest.status === 'format') {
    readonly = true;
    return;
  }
  if (latest.status === 'ok') localRec = latest.record;

  const held = prefer(idbRec, localRec);
  const lease = readLease() ?? leaseOf(held);
  if (!mayWrite(lease, owner, now)) return;
  if (!dirty && !staged) {
    try {
      await cache.flush();
    } catch {}
    if (reason !== 'interval') onWritten?.(reason);
    return;
  }

  const floor = Math.max(idbRec?.seq ?? 0, localRec?.seq ?? 0, seenSeq);
  const record =
    staged && staged.seq > (idbRec?.seq ?? 0) ? staged : stamp(body, floor + 1, now, today);
  if ((!staged || record !== staged) && !stageRecord(record)) return;
  stagedRevision = revision;
  setLease(record.owner, record.leaseUntil);
  seenSeq = record.seq;
  lastBody = body;
  try {
    await cache.flush();
  } catch {}
  onWritten?.(reason);
}

export async function replaceWorld(body: SimBody): Promise<boolean> {
  if (!installed || readonly) return false;
  const session = sessionRef as Restorable;
  const now = Date.now();
  const record = stamp(body, seenSeq + 1, now, localDate(new Date(now)));
  if (!stageRecord(record)) return false;
  await adoptBody(session, body);
  pending = body.pending;
  setLease(record.owner, record.leaseUntil);
  seenSeq = record.seq;
  lastBody = captureBody(session, pending);
  stagedRevision = ++writeRevision;
  try {
    await cache.flush();
  } catch {}
  listener?.({
    restored: true,
    cause: null,
    pendingText: pending?.text ?? null,
  });
  return true;
}

async function catchUp(): Promise<void> {
  if (readonly) return;
  const session = sessionRef as Restorable;
  const today = localDate(new Date());
  const chosen = await currentRecord(today);
  if (chosen === 'format') {
    readonly = true;
    return;
  }
  if (!chosen || chosen.seq <= seenSeq || chosen.owner === owner) return;
  setLease(chosen.owner, chosen.leaseUntil);
  await adoptBody(session, strip(chosen));
  pending = chosen.pending;
  seenSeq = chosen.seq;
  lastBody = captureBody(session, pending);
  if (!stageRecord(chosen)) return;
  stagedRevision = ++writeRevision;
  listener?.({
    restored: true,
    cause: null,
    pendingText: chosen.pending?.text ?? null,
  });
}

async function currentRecord(today: string): Promise<WorldRecord | 'format' | undefined> {
  const ls = classify(readBuffer(), today);
  let idb: Classify = { status: 'empty' };
  try {
    idb = classify(await readIdb(), today);
  } catch {}
  if (ls.status === 'format' || idb.status === 'format') return 'format';
  return (
    chooseRecord(
      ls.status === 'ok' ? ls.record : null,
      idb.status === 'ok' ? idb.record : null,
      today,
    ) ?? undefined
  );
}

async function mirror(chosen: WorldRecord, ls: Classify, idb: Classify): Promise<void> {
  const lsSame =
    ls.status === 'ok' && ls.record.seq === chosen.seq && ls.record.savedAt === chosen.savedAt;
  const idbSame =
    idb.status === 'ok' && idb.record.seq === chosen.seq && idb.record.savedAt === chosen.savedAt;
  if (!lsSame || !idbSame) {
    if (!stageRecord(chosen)) return;
    try {
      await cache.flush();
    } catch {}
  }
}

async function forget(item: Classify, side: 'local' | 'idb', today: string): Promise<void> {
  if (item.status !== 'malformed') return;
  if (side === 'local') {
    forgetBuffer();
    return;
  }
  try {
    const store = await resolveStore();
    await store.sweepSnapshots(today);
    await store.removeSnapshot();
  } catch {}
}

async function loadIdb(
  today: string,
): Promise<{ idb: Classify; opened: boolean; deferred: boolean }> {
  let deferred = false;
  let value: unknown = null;
  const ready = await new Promise<boolean>((resolve) => {
    const guardTimer = setTimeout(() => {
      deferred = true;
      resolve(false);
    }, OPEN_MS);
    resolveStore()
      .then((store) => store.readSnapshot())
      .then(
        (record) => {
          value = record;
          clearTimeout(guardTimer);
          resolve(true);
        },
        () => {
          clearTimeout(guardTimer);
          resolve(false);
        },
      );
  });
  if (!ready) return { idb: { status: 'empty' }, opened: false, deferred };
  return { idb: classify(value, today), opened: true, deferred: false };
}

async function reconcile(): Promise<void> {
  const session = sessionRef as Restorable;
  const today = localDate(new Date());
  let idb: Classify = { status: 'empty' };
  try {
    idb = classify(await readIdb(), today);
  } catch {
    dbDeferred = false;
    return;
  }
  dbDeferred = false;
  if (idb.status === 'format') {
    readonly = true;
    return;
  }
  if (idb.status !== 'ok' || idb.record.seq <= seenSeq) return;
  setLease(idb.record.owner, idb.record.leaseUntil);
  await adoptBody(session, strip(idb.record));
  pending = idb.record.pending;
  seenSeq = idb.record.seq;
  lastBody = captureBody(session, pending);
  if (!stageRecord(idb.record)) return;
  stagedRevision = ++writeRevision;
  listener?.({
    restored: true,
    cause: null,
    pendingText: idb.record.pending?.text ?? null,
  });
}

async function readIdb(): Promise<unknown> {
  return cache.readPersistent();
}

function stamp(body: SimBody, seq: number, now: number, today: string): WorldRecord {
  return {
    ...body,
    id: 'current',
    format: 3,
    savedAt: now,
    day: today,
    owner,
    seq,
    leaseUntil: now + LEASE_MS,
  };
}

export function prefer(a?: WorldRecord, b?: WorldRecord): WorldRecord | undefined {
  return a && b ? newer(a, b) : (a ?? b);
}

function changed(prev: SimBody, next: SimBody, appleSlack: number): boolean {
  const dx = next.spider.position.x - prev.spider.position.x;
  const dz = next.spider.position.z - prev.spider.position.z;
  if (Math.hypot(dx, dz) > MOVE_M) return true;
  if (yawGap(prev.spider.yaw, next.spider.yaw) > YAW_M) return true;
  if (prev.sprouts !== next.sprouts) return true;
  if (prev.seed !== next.seed) return true;
  if (
    (prev.pending?.text ?? '') !== (next.pending?.text ?? '') ||
    (prev.pending?.tool ?? null) !== (next.pending?.tool ?? null)
  ) {
    return true;
  }
  if (prev.appleIn - next.appleIn >= appleSlack) return true;
  if (!sameMarks(prev.marks, next.marks)) return true;
  return !sameList(prev.entities, next.entities) || !sameList(prev.carrying, next.carrying);
}

function sameMarks(a: SimBody['marks'], b: SimBody['marks']): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, index) => {
    const other = b[index];
    return (
      mark.name === other.name &&
      quant(mark.x) === quant(other.x) &&
      quant(mark.z) === quant(other.z) &&
      (mark.note ?? '') === (other.note ?? '')
    );
  });
}

function sameList(a: SimBody['entities'], b: SimBody['entities']): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      item.id === other.id &&
      item.stage === other.stage &&
      quant(item.x) === quant(other.x) &&
      quant(item.z) === quant(other.z) &&
      sameFoot(item.footprint, other.footprint)
    );
  });
}

function sameFoot(
  a: SimBody['entities'][number]['footprint'],
  b: SimBody['entities'][number]['footprint'],
): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'circle' && b.kind === 'circle') return a.r === b.r;
  return a.kind === 'box' && b.kind === 'box' && a.hx === b.hx && a.hz === b.hz;
}

function yawGap(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function quant(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function adoptBody(session: Restorable, body: SimBody): Promise<void> {
  const existing = session.world.terrain instanceof Terrain ? session.world.terrain : null;
  if (existing && existing.seed === body.seed) {
    applyBody(session, body, existing);
    return;
  }
  if (terrainFor) {
    applyBody(session, body, await terrainFor(body.seed));
    return;
  }
  session.adopt(body);
}

function strip(record: WorldRecord): SimBody {
  return {
    scenery: record.scenery,
    seed: record.seed,
    appleIn: record.appleIn,
    sprouts: record.sprouts,
    entities: record.entities,
    marks: record.marks,
    carrying: record.carrying,
    spider: record.spider,
    pending: record.pending,
  };
}

function arm(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (document.visibilityState !== 'visible' || readonly) return;
  timer = setInterval(() => flushWorld('interval'), SAVE_MS);
}

function enqueue(work: () => Promise<void>): void {
  workTail = workTail.then(work, work).catch(() => undefined);
}
