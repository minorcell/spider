import { localDate } from '../shared/dates.js';
import type { SnapshotStore } from './journal/store.js';
import {
  captureBody,
  chooseRecord,
  classify,
  newer,
  type Classify,
  type Restorable,
  type SimBody,
  type WorldRecord,
} from '../shared/sim/snapshot.js';

const BUFFER_KEY = 'p5-art.world';
const OWNER_KEY = 'p5-art.world.owner';
const LEASE_KEY = 'p5-art.world.lease';
const SAVE_MS = 10_000;
const LEASE_MS = 30_000;
const POKE_MS = 400;
const APPLE_DIRTY_S = 5;
const MOVE_M = 0.05;
const YAW_M = 0.02;
/** A version-2 tab holds the database open. Do not sit on a blank page. */
const OPEN_MS = 1500;

export interface BootNote {
  restored: boolean;
  /** Unknown format, or JSON that could not be loaded. Expired and first visits are false. */
  unreadable: boolean;
  cause: 'format' | 'malformed' | null;
  pendingText: string | null;
}

type Reason = 'interval' | 'hide' | 'poke';

interface Lease {
  owner: string;
  until: number;
}

let installed = false;
let readonly = false;
let dbDeferred = false;
let owner = '';
let seenSeq = 0;
let lastBody: SimBody | null = null;
let pending: SimBody['pending'] = null;
let pendingGen = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let pokeTimer: ReturnType<typeof setTimeout> | undefined;
let sessionRef: Restorable | null = null;
let listener: ((note: BootNote) => void) | null = null;
let onVis: (() => void) | null = null;
let inflight = 0;
const idle: Array<() => void> = [];
let providedStore: SnapshotStore | null = null;
let storePromise: Promise<SnapshotStore> | null = null;

/** The Worker-backed store in the page; IndexedDB directly in tests and old browsers. */
function resolveStore(): Promise<SnapshotStore> {
  if (providedStore) return Promise.resolve(providedStore);
  storePromise ??= import('./journal/store.js').then((module) => module.dbSnapshotStore());
  return storePromise;
}

/**
 * Ownership is a tiny separate key. The snapshot is only written when the
 * world changes; a quiet tab renews this key instead of the whole record.
 */
function readLease(): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Lease>;
    if (typeof parsed.owner !== 'string' || !Number.isFinite(parsed.until)) return null;
    return { owner: parsed.owner, until: parsed.until as number };
  } catch {
    return null;
  }
}

function setLease(page: string, until: number): void {
  try {
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: page, until }));
  } catch {
    // The snapshot still carries an owner and a lease.
  }
}

function leaseOf(record?: WorldRecord): Lease | null {
  return record ? { owner: record.owner, until: record.leaseUntil } : null;
}

/** Keep a quiet tab's ownership without rewriting the snapshot. */
function touchLease(): void {
  const lease = readLease();
  if (!lease || lease.owner !== owner) return;
  const now = Date.now();
  if (lease.until - now > LEASE_MS / 2) return;
  setLease(owner, now + LEASE_MS);
}

export function setPending(next: SimBody['pending']): number {
  pendingGen += 1;
  pending = next && next.text !== '' ? { text: next.text, tool: next.tool } : null;
  return pendingGen;
}

export function pendingNow(): SimBody['pending'] {
  return pending;
}

export function onRestore(listen: (note: BootNote) => void): void {
  listener = listen;
}

export function flushWorld(reason: Reason): void {
  if (!installed || readonly || !sessionRef) return;
  if (pokeTimer) {
    clearTimeout(pokeTimer);
    pokeTimer = undefined;
  }
  track(write(reason));
}

/** Coalesce bursts of tool calls into one write. Hide and submit still flush now. */
export function flushSoon(reason: Reason): void {
  if (!installed || readonly || !sessionRef) return;
  if (pokeTimer) clearTimeout(pokeTimer);
  pokeTimer = setTimeout(() => {
    pokeTimer = undefined;
    flushWorld(reason);
  }, POKE_MS);
}

export function writesDone(): Promise<void> {
  if (inflight === 0) return Promise.resolve();
  return new Promise((resolve) => idle.push(resolve));
}

/** Tests drop the timer and the visibility listener between cases. */
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
  try {
    sessionStorage.removeItem(OWNER_KEY);
  } catch {
    // A blocked session store just means the next launch mints an owner.
  }
  try {
    localStorage.removeItem(LEASE_KEY);
  } catch {
    // A blocked buffer is replaced by the next write anyway.
  }
  seenSeq = 0;
  lastBody = null;
  pending = null;
  pendingGen = 0;
  sessionRef = null;
  listener = null;
  providedStore = null;
  storePromise = null;
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
    return { restored: false, unreadable: true, cause: 'format', pendingText: null };
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
      unreadable: broken,
      cause: broken ? 'malformed' : null,
      pendingText: null,
    };
  }
  if (!readLease()) setLease(chosen.owner, chosen.leaseUntil);
  session.adopt(strip(chosen));
  pending = chosen.pending;
  seenSeq = chosen.seq;
  lastBody = captureBody(session, pending);
  if (dbOpen && !dbDeferred) await mirror(chosen, ls, idb);
  return {
    restored: true,
    unreadable: false,
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
  if (!lastBody) lastBody = captureBody(session, pending);
  if (onVis) document.removeEventListener('visibilitychange', onVis);
  onVis = () => {
    if (document.visibilityState === 'hidden') {
      flushWorld('hide');
      if (timer) clearInterval(timer);
      timer = undefined;
      return;
    }
    track(catchUp().then(() => arm()));
  };
  document.addEventListener('visibilitychange', onVis);
  if (dbDeferred) {
    track(reconcile().then(() => arm()));
    return;
  }
  arm();
}

async function write(reason: Reason): Promise<void> {
  // flushWorld checked readonly and sessionRef before calling.
  if (reason === 'interval') touchLease();
  const session = sessionRef as Restorable;
  const now = Date.now();
  const today = localDate(new Date(now));
  const body = captureBody(session, pending);
  const slack = reason === 'interval' ? APPLE_DIRTY_S : 0.05;
  const dirty = !lastBody || changed(lastBody, body, slack);

  const local = classify(readBuffer(), today);
  if (local.status === 'format') {
    readonly = true;
    return;
  }
  const localRec = local.status === 'ok' ? local.record : undefined;

  // pagehide cannot wait for IndexedDB. The buffer is written before any await.
  let staged: WorldRecord | null = null;
  if (reason === 'hide' || dbDeferred) {
    const stagingLease = readLease() ?? leaseOf(localRec);
    if (dirty && mayWrite(stagingLease, owner, now)) {
      const seq = Math.max(localRec?.seq ?? 0, seenSeq) + 1;
      staged = stamp(body, seq, now, today);
      if (bufferPut(staged)) {
        seenSeq = seq;
        lastBody = body;
      } else staged = null;
    }
  }
  if (dbDeferred) return;

  let idbRec: WorldRecord | undefined;
  try {
    const idb = classify(await readIdb(), today);
    if (idb.status === 'format') {
      readonly = true;
      return;
    }
    if (idb.status === 'ok') idbRec = idb.record;
  } catch {
    // The buffer is the copy when the database cannot be opened.
  }

  const held = prefer(idbRec, localRec);
  const lease = readLease() ?? leaseOf(held);
  if (!mayWrite(lease, owner, now)) return;
  if (!dirty && !staged) return;

  const floor = Math.max(idbRec?.seq ?? 0, localRec?.seq ?? 0, seenSeq);
  const record =
    staged && staged.seq > (idbRec?.seq ?? 0) ? staged : stamp(body, floor + 1, now, today);
  const storedLocal = bufferPut(record);
  let storedDb = false;
  try {
    const store = await resolveStore();
    await store.putSnapshot(record);
    storedDb = true;
    await store.sweepSnapshots(today);
  } catch {
    // The walk continues when the ledger cannot be written.
  }
  if (!storedLocal && !storedDb) return;
  setLease(record.owner, record.leaseUntil);
  seenSeq = record.seq;
  lastBody = body;
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
  session.adopt(strip(chosen));
  pending = chosen.pending;
  seenSeq = chosen.seq;
  lastBody = captureBody(session, pending);
  listener?.({
    restored: true,
    unreadable: false,
    cause: null,
    pendingText: chosen.pending?.text ?? null,
  });
}

async function currentRecord(today: string): Promise<WorldRecord | 'format' | undefined> {
  const ls = classify(readBuffer(), today);
  let idb: Classify = { status: 'empty' };
  try {
    idb = classify(await readIdb(), today);
  } catch {
    // Use the buffer alone when the database cannot be opened.
  }
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
  if (!lsSame) {
    try {
      localStorage.setItem(BUFFER_KEY, JSON.stringify(chosen));
    } catch {
      // The database copy is enough for the next quiet launch.
    }
  }
  if (!idbSame) {
    try {
      await (await resolveStore()).putSnapshot(chosen);
    } catch {
      // The buffer still wins on the next launch.
    }
  }
}

async function forget(item: Classify, side: 'local' | 'idb', today: string): Promise<void> {
  if (item.status !== 'expired' && item.status !== 'malformed') return;
  if (side === 'local') {
    try {
      localStorage.removeItem(BUFFER_KEY);
    } catch {
      // Leave a blocked buffer alone.
    }
    return;
  }
  try {
    const store = await resolveStore();
    await store.sweepSnapshots(today);
    await store.removeSnapshot();
  } catch {
    // A failed delete still leaves the page on a fresh island.
  }
}

async function loadIdb(
  today: string,
): Promise<{ idb: Classify; opened: boolean; deferred: boolean }> {
  let deferred = false;
  let value: unknown = null;
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      deferred = true;
      resolve(false);
    }, OPEN_MS);
    resolveStore()
      .then((store) => store.readSnapshot())
      .then(
        (record) => {
          value = record;
          clearTimeout(timer);
          resolve(true);
        },
        () => {
          clearTimeout(timer);
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
  session.adopt(strip(idb.record));
  pending = idb.record.pending;
  seenSeq = idb.record.seq;
  lastBody = captureBody(session, pending);
  listener?.({
    restored: true,
    unreadable: false,
    cause: null,
    pendingText: idb.record.pending?.text ?? null,
  });
}

async function readIdb(): Promise<unknown> {
  return (await resolveStore()).readSnapshot();
}

function pageOwner(): string {
  try {
    const saved = sessionStorage.getItem(OWNER_KEY);
    if (saved) return saved;
    const created = globalThis.crypto.randomUUID();
    sessionStorage.setItem(OWNER_KEY, created);
    return created;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

function stamp(body: SimBody, seq: number, now: number, today: string): WorldRecord {
  return {
    ...body,
    id: 'current',
    format: 1,
    savedAt: now,
    day: today,
    owner,
    seq,
    leaseUntil: now + LEASE_MS,
  };
}

function bufferPut(record: WorldRecord): boolean {
  try {
    localStorage.setItem(BUFFER_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** The later of two records; the one that exists when only one does. */
export function prefer(a?: WorldRecord, b?: WorldRecord): WorldRecord | undefined {
  return a && b ? newer(a, b) : (a ?? b);
}

function readBuffer(): unknown {
  try {
    return localStorage.getItem(BUFFER_KEY);
  } catch {
    return null;
  }
}

function mayWrite(lease: Lease | null, page: string, now: number): boolean {
  if (!lease) return true;
  if (lease.owner === page) return true;
  return lease.until <= now;
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
  return !sameList(prev.entities, next.entities) || !sameList(prev.carrying, next.carrying);
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

function strip(record: WorldRecord): SimBody {
  return {
    seed: record.seed,
    appleIn: record.appleIn,
    sprouts: record.sprouts,
    entities: record.entities,
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

function track(work: Promise<void>): void {
  inflight += 1;
  void work.finally(() => {
    inflight -= 1;
    if (inflight === 0) {
      for (const done of idle.splice(0)) done();
    }
  });
}
