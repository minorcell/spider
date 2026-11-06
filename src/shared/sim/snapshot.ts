import { CARRY_LIMIT, MARK_LIMIT, MARK_NAME_MAX, MARK_NOTE_MAX, MOUNTS } from '../config.js';
import { KINDS } from '../kinds.js';
import type { EntityState, Footprint, PlaceMark, SpiderState, WorldState } from '../state.js';
import { blockedAt, BODY_RADIUS } from '../sight.js';
import { APPLE_EVERY, nestBlocks, restingY } from '../world.js';
import { insideLand, Terrain } from '../terrain.js';
import { waterAt } from '../water.js';
import { bindLegWorld } from './bindWorld.js';
import type { Spider } from './Spider.js';

export const FORMAT = 3;
export const MAX_ENTITIES = 64;
export const MAX_PENDING = 4000;
export const MAX_JSON = 64_000;
const MAX_SPROUTS = 1_000_000;
const MAX_TOOL = 32;
/**
 * The island rim is 52. A planted foot and a prop set down past that rim are
 * still this spider. Farther than this is garbage, and the snapshot is dropped.
 */
const PLACE_M = 1_000_000;
const PLACE_Y = 1_000;

/** World body. No lease and no database key. */
export interface SimBody {
  seed: number;
  appleIn: number;
  sprouts: number;
  entities: EntityState[];
  marks: PlaceMark[];
  carrying: EntityState[];
  spider: SpiderState;
  pending: { text: string; tool: string | null } | null;
}

/** One stored record. IndexedDB and localStorage share this shape. */
export interface WorldRecord extends SimBody {
  id: 'current';
  format: 3;
  savedAt: number;
  /** Local day of the write. */
  day: string;
  owner: string;
  seq: number;
  leaseUntil: number;
}

export type Classify =
  | { status: 'ok'; record: WorldRecord }
  | { status: 'malformed' | 'format' | 'empty' };

export interface Restorable {
  cancel(): void;
  adopt(body: SimBody): void;
  readonly world: WorldState;
  readonly spider: Spider;
}

export function captureBody(session: Restorable, pending: SimBody['pending']): SimBody {
  const world = session.world;
  return {
    seed: world.seed,
    appleIn: world.appleIn ?? APPLE_EVERY,
    sprouts: world.sprouts ?? 0,
    entities: structuredClone(world.entities),
    marks: structuredClone(world.marks),
    carrying: structuredClone(world.carrying),
    spider: session.spider.capture(),
    pending: cleanPending(pending),
  };
}

export function applyBody(
  session: Restorable,
  body: SimBody,
  terrain = new Terrain(body.seed),
): void {
  session.cancel();
  const world = session.world;
  world.terrain = terrain;
  world.seed = terrain.seed;
  world.blocks = nestBlocks();
  // 地形函数会改；恢复时把落地的道具重新放到当前地面上。
  world.entities = structuredClone(body.entities).map((entity) =>
    entity.kind === 'nest'
      ? entity
      : { ...entity, y: restingY(terrain, entity.kind, entity.x, entity.z, entity.footprint) },
  );
  world.marks = structuredClone(body.marks);
  world.carrying = structuredClone(body.carrying);
  world.appleIn = body.appleIn;
  world.sprouts = body.sprouts;
  bindLegWorld(session.spider, world);
  session.spider.bindGround((x, z) => world.terrain.height(x, z));
  session.spider.bindWater((x, z) => waterAt(world.terrain, x, z));
  session.spider.bindBlocked(
    (x, z) => blockedAt(x, z, world.blocks) || !insideLand(world.terrain, x, z, BODY_RADIUS),
  );
  session.spider.settle(body.spider);
}

export function chooseRecord(ls: unknown, idb: unknown, today: string): WorldRecord | null {
  const ranked = [ls, idb]
    .map((value) => classify(value, today))
    .filter((item) => item.status === 'ok')
    .map((item) => item.record);
  if (ranked.length === 0) return null;
  return ranked.reduce(newer);
}

export function newer(a: WorldRecord, b: WorldRecord): WorldRecord {
  if (a.seq !== b.seq) return a.seq > b.seq ? a : b;
  return a.savedAt >= b.savedAt ? a : b;
}

export function classify(input: unknown, _today?: string): Classify {
  if (input == null || input === '') return { status: 'empty' };
  let value: unknown = input;
  if (typeof value === 'string') {
    if (value.length > MAX_JSON) return { status: 'malformed' };
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { status: 'malformed' };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'malformed' };
  const raw = value as Record<string, unknown>;
  if (!isFiniteNumber(raw.format) || !Number.isSafeInteger(raw.format) || raw.format < 1) {
    return { status: 'malformed' };
  }
  if (raw.format < FORMAT) return { status: 'malformed' };
  if (raw.format > FORMAT) return { status: 'format' };
  if (!isDay(raw.day)) return { status: 'malformed' };
  if (
    !isFiniteNumber(raw.savedAt) ||
    !isFiniteNumber(raw.seq) ||
    !Number.isInteger(raw.seq) ||
    raw.seq < 1
  ) {
    return { status: 'malformed' };
  }
  if (!isFiniteNumber(raw.leaseUntil) || typeof raw.owner !== 'string' || raw.owner.length === 0) {
    return { status: 'malformed' };
  }
  if (raw.id !== 'current') return { status: 'malformed' };
  const body = bodyOf(raw);
  if (!body) return { status: 'malformed' };
  const record: WorldRecord = {
    ...body,
    id: 'current',
    format: FORMAT,
    savedAt: raw.savedAt as number,
    day: raw.day as string,
    owner: raw.owner as string,
    seq: raw.seq as number,
    leaseUntil: raw.leaseUntil as number,
  };
  return { status: 'ok', record };
}

function bodyOf(raw: Record<string, unknown>): SimBody | null {
  if (!isFiniteNumber(raw.seed)) return null;
  if (!isFiniteNumber(raw.appleIn) || raw.appleIn < 0 || raw.appleIn > APPLE_EVERY) return null;
  if (!isFiniteNumber(raw.sprouts) || !Number.isInteger(raw.sprouts)) return null;
  if (raw.sprouts < 0 || raw.sprouts > MAX_SPROUTS) return null;
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.carrying)) return null;
  if (raw.carrying.length > CARRY_LIMIT) return null;
  const count = raw.entities.length + raw.carrying.length;
  if (count < 1 || count > MAX_ENTITIES) return null;
  const entities = raw.entities.map(readEntity);
  const carrying = raw.carrying.map(readEntity);
  if (entities.some((entity) => !entity) || carrying.some((entity) => !entity)) return null;
  const ground = entities as EntityState[];
  const held = carrying as EntityState[];
  const homes = ground.filter((entity) => entity.id === 'home' && entity.kind === 'nest');
  if (homes.length !== 1) return null;
  const ids = new Set<string>();
  for (const entity of [...ground, ...held]) {
    if (ids.has(entity.id)) return null;
    ids.add(entity.id);
  }
  const spider = readSpider(raw.spider);
  if (!spider) return null;
  const pending = readPending(raw.pending);
  if (pending === undefined) return null;
  const marks = readMarks(raw.marks);
  if (!marks) return null;
  return {
    seed: raw.seed >>> 0,
    appleIn: raw.appleIn as number,
    sprouts: raw.sprouts as number,
    entities: ground,
    marks,
    carrying: held,
    spider,
    pending,
  };
}

/** No marks is a valid old body. A present list must stay inside the limits. */
function readMarks(value: unknown): PlaceMark[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MARK_LIMIT) return null;
  const marks: PlaceMark[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.name !== 'string' ||
      raw.name.length === 0 ||
      raw.name.length > MARK_NAME_MAX ||
      raw.name.trim() !== raw.name ||
      names.has(raw.name)
    ) {
      return null;
    }
    if (!placed(raw.x, 0, raw.z)) return null;
    let note: string | undefined;
    if (raw.note !== undefined) {
      if (
        typeof raw.note !== 'string' ||
        raw.note.length === 0 ||
        raw.note.length > MARK_NOTE_MAX ||
        raw.note.trim() !== raw.note
      ) {
        return null;
      }
      note = raw.note;
    }
    const mark: PlaceMark = { name: raw.name, x: raw.x as number, z: raw.z as number };
    if (note !== undefined) mark.note = note;
    names.add(raw.name);
    marks.push(mark);
  }
  return marks;
}

function readEntity(value: unknown): EntityState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== 'string' || !Object.hasOwn(KINDS, raw.kind)) return null;
  if (typeof raw.id !== 'string' || !/^[\w.-]{1,64}$/.test(raw.id)) return null;
  if (
    !placed(raw.x, raw.y, raw.z) ||
    !isFiniteNumber(raw.stage) ||
    raw.stage < 0 ||
    raw.stage > 8
  ) {
    return null;
  }
  if (!footprintOk(raw.footprint)) return null;
  const vx = optionalNumber(raw.vx);
  const vy = optionalNumber(raw.vy);
  const vz = optionalNumber(raw.vz);
  if (vx === null || vy === null || vz === null) return null;
  const entity: EntityState = {
    id: raw.id,
    kind: raw.kind,
    x: raw.x as number,
    y: raw.y as number,
    z: raw.z as number,
    stage: raw.stage as number,
  };
  if (raw.footprint) entity.footprint = raw.footprint as Footprint;
  if (vx !== undefined) entity.vx = vx;
  if (vy !== undefined) entity.vy = vy;
  if (vz !== undefined) entity.vz = vz;
  const spin = readSpin(raw);
  if (spin === null) return null;
  if (spin) {
    entity.qx = spin.qx;
    entity.qy = spin.qy;
    entity.qz = spin.qz;
    entity.qw = spin.qw;
  }
  return entity;
}

/** Identity when absent. A partial or non-finite orientation is a bad record. */
function readSpin(
  raw: Record<string, unknown>,
): { qx: number; qy: number; qz: number; qw: number } | null | undefined {
  const qx = optionalNumber(raw.qx);
  const qy = optionalNumber(raw.qy);
  const qz = optionalNumber(raw.qz);
  const qw = optionalNumber(raw.qw);
  if (qx === null || qy === null || qz === null || qw === null) return null;
  if (qx === undefined && qy === undefined && qz === undefined && qw === undefined)
    return undefined;
  if (qx === undefined || qy === undefined || qz === undefined || qw === undefined) return null;
  return { qx, qy, qz, qw };
}

/** 缺省或有限数字；其他值是坏记录。 */
function optionalNumber(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return isFiniteNumber(value) ? value : null;
}

function readSpider(value: unknown): SpiderState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const position = raw.position as { x?: unknown; y?: unknown; z?: unknown } | null;
  if (!position || !placed(position.x, position.y, position.z)) return null;
  if (!isFiniteNumber(raw.yaw)) return null;
  for (const key of [
    'time',
    'speed',
    'height',
    'chassisPitch',
    'chassisRoll',
    'headYaw',
  ] as const) {
    if (!isFiniteNumber(raw[key])) return null;
  }
  if (!Array.isArray(raw.feet) || raw.feet.length !== MOUNTS.length) return null;
  const feet: SpiderState['feet'] = [];
  for (const foot of raw.feet) {
    const point = foot as { x?: unknown; y?: unknown; z?: unknown };
    if (!placed(point?.x, point?.y, point?.z)) return null;
    feet.push({ x: point.x as number, y: point.y as number, z: point.z as number });
  }
  return {
    time: raw.time as number,
    position: { x: position.x as number, y: position.y as number, z: position.z as number },
    yaw: raw.yaw,
    speed: raw.speed as number,
    height: raw.height as number,
    chassisPitch: raw.chassisPitch as number,
    chassisRoll: raw.chassisRoll as number,
    headYaw: raw.headYaw as number,
    feet,
  };
}

/** `null` is no sentence. `undefined` means the field is unusable. */
function readPending(value: unknown): SimBody['pending'] | undefined {
  if (value == null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { text?: unknown; tool?: unknown };
  if (typeof raw.text !== 'string' || raw.text.length > MAX_PENDING) return undefined;
  if (raw.text.length === 0) return null;
  if (raw.tool != null && (typeof raw.tool !== 'string' || raw.tool.length > MAX_TOOL))
    return undefined;
  return { text: raw.text, tool: typeof raw.tool === 'string' ? raw.tool : null };
}

function cleanPending(pending: SimBody['pending']): SimBody['pending'] {
  if (!pending || pending.text === '') return null;
  return {
    text: pending.text.slice(0, MAX_PENDING),
    tool: pending.tool?.slice(0, MAX_TOOL) ?? null,
  };
}

function footprintOk(value: unknown): boolean {
  if (value == null) return true;
  if (!value || typeof value !== 'object') return false;
  const raw = value as { kind?: unknown; r?: unknown; hx?: unknown; hz?: unknown };
  if (raw.kind === 'circle') return isFiniteNumber(raw.r) && raw.r > 0 && raw.r <= 20;
  if (raw.kind === 'box') {
    return (
      isFiniteNumber(raw.hx) &&
      isFiniteNumber(raw.hz) &&
      raw.hx > 0 &&
      raw.hz > 0 &&
      raw.hx <= 20 &&
      raw.hz <= 20
    );
  }
  return false;
}

function placed(x: unknown, y: unknown, z: unknown): boolean {
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    isFiniteNumber(z) &&
    Math.abs(x) <= PLACE_M &&
    Math.abs(z) <= PLACE_M &&
    Math.abs(y) <= PLACE_Y
  );
}

function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
