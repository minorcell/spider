import { localDate } from '../../shared/dates.js';
import { chooseRecord } from '../../shared/sim/snapshot.js';
import { onDiaryChange } from '../journal/diary.js';
import { openSpiderDb } from '../journal/db.js';
import { readBuffer } from '../world/storage.js';
import { onWorldWritten, replaceWorld, setCloudLock } from '../worldStore.js';
import { worldOf, type CloudBundle } from './bundle.js';
import {
  blankEngine,
  chooseLocal,
  chooseRemote,
  keepalive,
  reconcile,
  renewLease,
  takeOver,
  type CloudChoice,
  type CloudCursor,
  type CloudIo,
  type CloudPhase,
  type Engine,
} from './engine.js';
import { keepaliveObject, requestObject } from './s3.js';
import { cloudReady, readCloud, restoreCloud } from './settings.js';

export type { CloudPhase } from './engine.js';

const IDLE_MS = 60_000;
const RENEW_MS = 30_000;

let engine: Engine = blankEngine();
let picture: ((held: boolean) => void) | null = null;
let onAdopted: (() => void) | null = null;
let tail: Promise<void> = Promise.resolve();
let leaseTimer: ReturnType<typeof setInterval> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(phase: CloudPhase) => void>();

const io: CloudIo = {
  now: () => Date.now(),
  settings: () => readCloud(),
  readCursor,
  writeCursor,
  readLocal,
  adopt,
  get: (key) => requestObject({ settings: readCloud(), method: 'GET', key }),
  put: (key, body, match) =>
    requestObject({ settings: readCloud(), method: 'PUT', key, body, match }),
  keepalive: (key, body, match) => {
    keepaliveObject({ settings: readCloud(), method: 'PUT', key, body, match });
  },
};

export function onCloudPhase(listen: (phase: CloudPhase) => void): void {
  listeners.add(listen);
}

export function cloudPhase(): CloudPhase {
  return engine.phase;
}

export function cloudChoice(): CloudChoice | null {
  return engine.choice;
}

export function cloudHolds(): boolean {
  return engine.phase.kind === 'locked' || engine.phase.kind === 'choose';
}

export async function startCloud(hooks: {
  hold(on: boolean): void;
  retile(): void;
}): Promise<void> {
  picture = hooks.hold;
  onAdopted = hooks.retile;
  await restoreCloud();
  onWorldWritten((reason) => noteCloud(reason));
  onDiaryChange(() => noteCloud('poke'));
  ensureTimers();
  await run(() => reconcile(io, engine));
}

/** World checkpoints call this. A quiet ten-second tick only schedules the idle upload. */
export function noteCloud(reason: 'interval' | 'hide' | 'poke'): Promise<void> | undefined {
  if (!cloudReady()) return;
  if (reason === 'interval') {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void run(() => reconcile(io, engine));
    }, IDLE_MS);
    return;
  }
  return run(() => reconcile(io, engine));
}

export function chooseCloudLocal(): Promise<void> {
  return run(() => chooseLocal(io, engine));
}

export function chooseCloudRemote(): Promise<void> {
  return run(() => chooseRemote(io, engine));
}

export function takeOverCloud(): Promise<void> {
  return run(() => takeOver(io, engine));
}

export function keepaliveCloud(): void {
  keepalive(io, engine);
}

export function resetCloud(): void {
  if (leaseTimer !== undefined) clearInterval(leaseTimer);
  clearTimeout(idleTimer);
  leaseTimer = undefined;
  idleTimer = undefined;
  window.removeEventListener('online', onOnline);
  listeners.clear();
  picture = null;
  onAdopted = null;
  engine = blankEngine();
  tail = Promise.resolve();
  setCloudLock(false);
  onWorldWritten(null);
  onDiaryChange(null);
}

function ensureTimers(): void {
  if (leaseTimer !== undefined) return;
  window.addEventListener('online', onOnline);
  leaseTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void run(() => renewLease(io, engine));
  }, RENEW_MS);
}

function onOnline(): void {
  void run(() => reconcile(io, engine));
}

function run(work: () => Promise<void>): Promise<void> {
  const task = tail.then(async () => {
    try {
      await work();
    } catch {
      engine.phase = { kind: 'error', message: '云端存档读不出来' };
    }
    publish();
  });
  tail = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function publish(): void {
  const held = cloudHolds();
  setCloudLock(held);
  if (picture) picture(held);
  if (engine.adopted) {
    engine.adopted = false;
    if (onAdopted) onAdopted();
  }
  for (const listen of listeners) listen(engine.phase);
}

async function readCursor(): Promise<CloudCursor> {
  const db = await openSpiderDb();
  const saved = await db.get('cloud', 'current');
  if (saved) return saved;
  const created: CloudCursor = {
    id: 'current',
    deviceId: crypto.randomUUID(),
    basisEtag: null,
    uploadedHash: null,
    leaseEtag: null,
  };
  await db.put('cloud', created);
  return created;
}

async function writeCursor(cursor: CloudCursor): Promise<void> {
  const db = await openSpiderDb();
  await db.put('cloud', cursor);
}

async function readLocal(deviceId: string): Promise<CloudBundle | null> {
  const db = await openSpiderDb();
  const chosen = chooseRecord(
    readBuffer(),
    await db.get('snapshots', 'current'),
    localDate(new Date()),
  );
  if (!chosen) return null;
  return { format: 1, deviceId, world: worldOf(chosen), memories: await db.getAll('memories') };
}

async function adopt(bundle: CloudBundle): Promise<boolean> {
  const db = await openSpiderDb();
  const tx = db.transaction('memories', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  for (const page of bundle.memories) await tx.store.put(page);
  await tx.done;
  return replaceWorld(bundle.world);
}
