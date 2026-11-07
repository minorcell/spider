import { canonicalBytes, progressHash } from './bytes.js';
import {
  bundleBytes,
  parseBundle,
  parseLease,
  type CloudBundle,
  type CloudLease,
} from './bundle.js';
import type { ObjectMatch, ObjectResult } from './s3.js';
import { cloudReady, type CloudSettings } from './settings.js';

export const WORLD_KEY = 'spider/world.json';
export const LEASE_KEY = 'spider/lease.json';
export const KEEPALIVE_LIMIT = 60_000;
export const LEASE_MS = 120_000;

export interface CloudCursor {
  id: 'current';
  deviceId: string;
  basisEtag: string | null;
  uploadedHash: string | null;
  leaseEtag: string | null;
}

export type CloudPhase =
  | { kind: 'off' }
  | { kind: 'ready' }
  | { kind: 'locked'; until: number }
  | { kind: 'choose' }
  | { kind: 'error'; message: string };

export interface CloudChoice {
  local: CloudBundle;
  remote: CloudBundle;
  remoteEtag: string;
}

export interface CachedBundle {
  body: Uint8Array;
  hash: string;
}

export interface Engine {
  phase: CloudPhase;
  cursor: CloudCursor | null;
  choice: CloudChoice | null;
  adopted: boolean;
  cached: CachedBundle | null;
}

export interface CloudIo {
  now(): number;
  settings(): CloudSettings;
  readCursor(): Promise<CloudCursor>;
  writeCursor(cursor: CloudCursor): Promise<void>;
  readLocal(deviceId: string): Promise<CloudBundle | null>;
  adopt(bundle: CloudBundle): Promise<boolean>;
  get(key: string): Promise<ObjectResult>;
  put(key: string, body: Uint8Array, match: ObjectMatch): Promise<ObjectResult>;
  keepalive(key: string, body: Uint8Array, match: ObjectMatch): void;
}

export function blankEngine(): Engine {
  return { phase: { kind: 'off' }, cursor: null, choice: null, adopted: false, cached: null };
}

type Step = 'done' | 'retry';

export async function reconcile(io: CloudIo, engine: Engine): Promise<void> {
  engine.adopted = false;
  if (!cloudReady(io.settings())) {
    engine.phase = { kind: 'off' };
    engine.choice = null;
    return;
  }
  const cursor = await io.readCursor();
  engine.cursor = cursor;
  for (let pass = 0; pass < 2; pass++) {
    if ((await passOnce(io, engine, cursor)) === 'done') return;
  }
  engine.phase = { kind: 'error', message: '云端存档正在被另一台电脑写入' };
}

export async function renewLease(io: CloudIo, engine: Engine): Promise<void> {
  if (!cloudReady(io.settings()) || engine.phase.kind !== 'ready' || !engine.cursor) return;
  await settleLease(io, engine, engine.cursor);
}

export async function chooseLocal(io: CloudIo, engine: Engine): Promise<void> {
  const choice = engine.choice;
  const cursor = engine.cursor;
  if (!choice || !cursor) return;
  if (!(await park(io, choice.remote))) return;
  const uploaded = await upload(io, engine, cursor, choice.local, {
    kind: 'if-match',
    etag: choice.remoteEtag,
  });
  if (uploaded === 'rejected') {
    await reconcile(io, engine);
    return;
  }
  if (uploaded === 'stop') return;
  engine.choice = null;
  engine.phase = { kind: 'ready' };
  await settleLease(io, engine, uploaded);
}

export async function chooseRemote(io: CloudIo, engine: Engine): Promise<void> {
  const choice = engine.choice;
  const cursor = engine.cursor;
  if (!choice || !cursor) return;
  if (!(await park(io, choice.local))) return;
  if (!(await adoptRemote(io, engine, choice.remote))) return;
  const hash = await progressHash(choice.remote.world, choice.remote.memories);
  const next = { ...cursor, basisEtag: choice.remoteEtag, uploadedHash: hash };
  await io.writeCursor(next);
  engine.cursor = next;
  engine.cached = { body: bundleBytes(choice.remote), hash };
  engine.choice = null;
  engine.phase = { kind: 'ready' };
  await settleLease(io, engine, next);
}

export async function takeOver(io: CloudIo, engine: Engine): Promise<void> {
  const cursor = engine.cursor;
  if (!cursor || engine.phase.kind !== 'locked') return;
  const local = await remember(io, engine, cursor.deviceId);
  if (local && local.hash !== cursor.uploadedHash && !(await park(io, local.bundle))) return;
  const lease = await io.get(LEASE_KEY);
  if (lease.status === 403) {
    deny(engine);
    return;
  }
  if (lease.status !== 200 || !lease.etag) return;
  const held = parseLease(lease.body);
  const body = canonicalBytes({ deviceId: cursor.deviceId, until: io.now() + LEASE_MS });
  const put = await io.put(LEASE_KEY, body, { kind: 'if-match', etag: lease.etag });
  if (put.status === 412) {
    engine.phase = { kind: 'locked', until: held?.until ?? io.now() };
    return;
  }
  if (put.status === 403) {
    deny(engine);
    return;
  }
  if (put.status !== 200 || !put.etag) return;
  const next = { ...cursor, leaseEtag: put.etag };
  await io.writeCursor(next);
  engine.cursor = next;
  engine.choice = null;
  engine.phase = { kind: 'ready' };
  const world = await io.get(WORLD_KEY);
  const bundle = world.status === 200 ? parseBundle(world.body) : null;
  if (world.status === 200 && world.etag && bundle) {
    if (!(await adoptRemote(io, engine, bundle))) return;
    await rememberRemote(io, engine, next, bundle, world.etag);
  }
  await reconcile(io, engine);
}

export function keepalive(io: CloudIo, engine: Engine): void {
  const cursor = engine.cursor;
  const cached = engine.cached;
  if (!cursor || !cloudReady(io.settings())) return;
  if (cached && cached.hash !== cursor.uploadedHash && cached.body.byteLength <= KEEPALIVE_LIMIT) {
    io.keepalive(
      WORLD_KEY,
      cached.body,
      cursor.basisEtag ? { kind: 'if-match', etag: cursor.basisEtag } : { kind: 'if-none-match' },
    );
  }
  const release = canonicalBytes({ deviceId: cursor.deviceId, until: io.now() });
  io.keepalive(
    LEASE_KEY,
    release,
    cursor.leaseEtag ? { kind: 'if-match', etag: cursor.leaseEtag } : { kind: 'if-none-match' },
  );
}

async function passOnce(io: CloudIo, engine: Engine, cursor: CloudCursor): Promise<Step> {
  const remote = await io.get(WORLD_KEY);
  if (remote.status === 0) return 'done';
  if (remote.status === 403) return deny(engine);
  const local = await remember(io, engine, cursor.deviceId);

  if (remote.status === 404) {
    if (!local) {
      engine.phase = { kind: 'ready' };
      return 'done';
    }
    const created = await upload(io, engine, cursor, local.bundle, { kind: 'if-none-match' });
    if (created === 'rejected') return 'retry';
    if (created === 'stop') return 'done';
    await settleLease(io, engine, created);
    return 'done';
  }
  if (remote.status !== 200) {
    engine.phase = { kind: 'error', message: '云端存档读不出来' };
    return 'done';
  }
  if (!remote.etag) {
    engine.phase = { kind: 'error', message: '端点没有返回可用的 ETag' };
    return 'done';
  }
  const bundle = parseBundle(remote.body);
  if (!bundle) {
    engine.phase = { kind: 'error', message: '云端存档读不出来' };
    return 'done';
  }

  if (!cursor.basisEtag) {
    if (!local) {
      if (!(await adoptRemote(io, engine, bundle))) return 'done';
      const adopted = await rememberRemote(io, engine, cursor, bundle, remote.etag);
      await settleLease(io, engine, adopted);
      return 'done';
    }
    engine.choice = { local: local.bundle, remote: bundle, remoteEtag: remote.etag };
    engine.phase = { kind: 'choose' };
    return 'done';
  }

  const remoteHash = await progressHash(bundle.world, bundle.memories);
  if (remote.etag === cursor.basisEtag) {
    if (!local || local.hash === cursor.uploadedHash) {
      await settleLease(io, engine, cursor);
      return 'done';
    }
    const lease = await io.get(LEASE_KEY);
    if (lease.status === 403) return deny(engine);
    const held = lease.status === 200 ? parseLease(lease.body) : null;
    if (held && held.deviceId !== cursor.deviceId && held.until > io.now()) {
      engine.choice = { local: local.bundle, remote: bundle, remoteEtag: remote.etag };
      engine.phase = { kind: 'choose' };
      return 'done';
    }
    const uploaded = await upload(io, engine, cursor, local.bundle, {
      kind: 'if-match',
      etag: cursor.basisEtag,
    });
    if (uploaded === 'rejected') return 'retry';
    if (uploaded === 'stop') return 'done';
    await settleLease(io, engine, uploaded);
    return 'done';
  }

  if (!local || local.hash === cursor.uploadedHash || local.hash === remoteHash) {
    if (!local || local.hash !== remoteHash) {
      if (!(await adoptRemote(io, engine, bundle))) return 'done';
    }
    const current = await rememberRemote(io, engine, cursor, bundle, remote.etag);
    await settleLease(io, engine, current);
    return 'done';
  }

  if (!(await park(io, local.bundle))) return 'done';
  if (!(await adoptRemote(io, engine, bundle))) return 'done';
  await rememberRemote(io, engine, cursor, bundle, remote.etag);
  engine.choice = {
    local: local.bundle,
    remote: bundle,
    remoteEtag: remote.etag,
  };
  engine.phase = { kind: 'choose' };
  return 'done';
}

async function remember(
  io: CloudIo,
  engine: Engine,
  deviceId: string,
): Promise<{ bundle: CloudBundle; hash: string } | null> {
  const bundle = await io.readLocal(deviceId);
  if (!bundle) return null;
  const hash = await progressHash(bundle.world, bundle.memories);
  engine.cached = { body: bundleBytes(bundle), hash };
  return { bundle, hash };
}

async function rememberRemote(
  io: CloudIo,
  engine: Engine,
  cursor: CloudCursor,
  bundle: CloudBundle,
  etag: string,
): Promise<CloudCursor> {
  const hash = await progressHash(bundle.world, bundle.memories);
  const next = { ...cursor, basisEtag: etag, uploadedHash: hash };
  await io.writeCursor(next);
  engine.cursor = next;
  engine.cached = { body: bundleBytes(bundle), hash };
  engine.phase = { kind: 'ready' };
  return next;
}

async function adoptRemote(io: CloudIo, engine: Engine, bundle: CloudBundle): Promise<boolean> {
  const adopted = await io.adopt(bundle);
  if (!adopted) {
    engine.phase = { kind: 'error', message: '云端存档读不出来' };
    return false;
  }
  engine.adopted = true;
  return true;
}

async function upload(
  io: CloudIo,
  engine: Engine,
  cursor: CloudCursor,
  bundle: CloudBundle,
  match: ObjectMatch,
): Promise<CloudCursor | 'rejected' | 'stop'> {
  const body = bundleBytes(bundle);
  const result = await io.put(WORLD_KEY, body, match);
  if (result.status === 403) {
    deny(engine);
    return 'stop';
  }
  if (result.status === 412) return 'rejected';
  if (result.status !== 200 || !result.etag) return 'stop';
  const hash = await progressHash(bundle.world, bundle.memories);
  const next = { ...cursor, basisEtag: result.etag, uploadedHash: hash };
  await io.writeCursor(next);
  engine.cursor = next;
  engine.cached = { body, hash };
  engine.phase = { kind: 'ready' };
  return next;
}

async function park(io: CloudIo, bundle: CloudBundle): Promise<boolean> {
  const safe = bundle.deviceId.replace(/[^A-Za-z0-9_-]/g, '_');
  const result = await io.put(`spider/conflicts/${safe}/${io.now()}.json`, bundleBytes(bundle), {
    kind: 'if-none-match',
  });
  return result.status === 200;
}

async function settleLease(io: CloudIo, engine: Engine, cursor: CloudCursor): Promise<void> {
  const got = await io.get(LEASE_KEY);
  if (got.status === 0) return;
  if (got.status === 403) {
    deny(engine);
    return;
  }
  const lease = got.status === 200 ? parseLease(got.body) : null;
  if (lease && lease.deviceId !== cursor.deviceId && lease.until > io.now()) {
    engine.phase = { kind: 'locked', until: lease.until };
    return;
  }
  const body = canonicalBytes(leaseBody(cursor.deviceId, io.now() + LEASE_MS));
  const match: ObjectMatch =
    got.status === 200 && got.etag
      ? { kind: 'if-match', etag: got.etag }
      : { kind: 'if-none-match' };
  const put = await io.put(LEASE_KEY, body, match);
  if (put.status === 200 && put.etag) {
    const next = { ...cursor, leaseEtag: put.etag };
    await io.writeCursor(next);
    engine.cursor = next;
    engine.phase = { kind: 'ready' };
    return;
  }
  if (put.status === 403) {
    deny(engine);
    return;
  }
  if (put.status !== 412) return;
  const again = await io.get(LEASE_KEY);
  const other = again.status === 200 ? parseLease(again.body) : null;
  if (other && other.deviceId !== cursor.deviceId && other.until > io.now()) {
    engine.phase = { kind: 'locked', until: other.until };
  }
}

function leaseBody(deviceId: string, until: number): CloudLease {
  return { deviceId, until };
}

function deny(engine: Engine): Step {
  engine.phase = { kind: 'error', message: '云端密钥被拒绝' };
  engine.choice = null;
  return 'done';
}
