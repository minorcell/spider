import { CARRY_LIMIT, MARK_LIMIT, MARK_NAME_MAX, MARK_NOTE_MAX, MOUNTS } from '@/src/shared/config';
import { kindOf } from '@/src/shared/kinds';
import {
  applePopulation,
  initialPopulations,
  islandFamilies,
  islandPlacements,
  populationRules,
  type PopulationState,
} from '@/src/shared/islandContent';
import type {
  EntityState,
  Footprint,
  PlaceMark,
  SpiderState,
  WorldState,
} from '@/src/shared/state';
import { blockedAt, BODY_RADIUS } from '@/src/shared/sight';
import {
  expireEntities,
  indexEntities,
  populateScenery,
  propBlocks,
  restingY,
  removeEntity,
} from '@/src/shared/world';
import { insideLand, Terrain } from '@/src/shared/terrain';
import { waterAt } from '@/src/shared/water';
import {
  carriedItems,
  MIN_TETHER_LENGTH,
  tetherAnchor,
  tetherLength,
} from '@/src/shared/sim/tether';
import { bindLegWorld } from '@/src/shared/sim/bindWorld';
import type { Spider } from '@/src/shared/sim/Spider';

export const FORMAT = 3;
export const MAX_ENTITIES = 160;
export const MAX_PENDING = 4000;
export const MAX_JSON = 64_000;
const MAX_SPROUTS = 1_000_000;
const MAX_TOOL = 32;
const PLACE_M = 1_000_000;
const PLACE_Y = 1_000;

interface CarriedRecord extends EntityState {
  tetherLength?: number;
}

export interface SimBody {
  scenery?: 1 | 2 | 3 | 4 | 5;
  seed: number;
  appleIn: number;
  sprouts: number;
  populations?: Record<string, PopulationState>;
  entitySerials?: Record<string, number>;
  entities: EntityState[];
  marks: PlaceMark[];
  carrying: CarriedRecord[];
  spider: SpiderState;
  pending: { text: string; tool: string | null } | null;
}

export interface WorldRecord extends SimBody {
  id: 'current';
  format: 3;
  savedAt: number;
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

export function bodyOfRecord(record: WorldRecord): SimBody {
  const {
    id: _id,
    format: _format,
    savedAt: _savedAt,
    day: _day,
    owner: _owner,
    seq: _seq,
    leaseUntil: _leaseUntil,
    ...body
  } = record;
  return body;
}

export function captureBody(session: Restorable, pending: SimBody['pending']): SimBody {
  const world = session.world;
  const { id: legacyId, interval } = applePopulation;
  const legacy = world.populations.get(legacyId);
  const populations = Object.fromEntries([...world.populations].filter(([id]) => id !== legacyId));
  const carrying: CarriedRecord[] = structuredClone(carriedItems(world));
  for (const item of carrying) item.tetherLength = world.tethers.get(item.id);
  return {
    scenery: 5,
    seed: world.seed,
    appleIn: legacy?.remaining ?? interval,
    sprouts: legacy?.attempts ?? 0,
    ...(world.entitySerials.size ? { entitySerials: Object.fromEntries(world.entitySerials) } : {}),
    ...(Object.keys(populations).length > 0 ? { populations: structuredClone(populations) } : {}),
    entities: structuredClone(
      [...world.entities.values()].filter((item) => !world.tethers.has(item.id)),
    ),
    marks: structuredClone(world.marks),
    carrying,
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
  let ground = structuredClone(body.entities);
  for (const family of islandFamilies) {
    const legacy = family.legacy;
    if (legacy?.cap.includes(body.scenery)) {
      let count = 0;
      ground = ground.filter((entity) => entity.kind !== family.kind || ++count <= family.count);
    }
    if (legacy?.footprint?.includes(body.scenery)) {
      for (const entity of ground) {
        if (entity.kind === family.kind)
          entity.footprint = kindOf(entity.kind)?.placement?.footprint(entity.id);
      }
    }
  }
  for (const entity of ground) {
    if (!kindOf(entity.kind)?.fixedElevation)
      entity.y = restingY(terrain, entity.kind, entity.x, entity.z, entity.footprint);
  }
  world.entities = indexEntities(ground);
  world.entitySerials = new Map(Object.entries(body.entitySerials ?? {}));
  world.blocks = propBlocks(ground);
  world.marks = structuredClone(body.marks);
  world.tethers.clear();
  const anchor = tetherAnchor(body.spider.position, body.spider.yaw);
  for (const [index, { tetherLength: length, ...item }] of structuredClone(
    body.carrying,
  ).entries()) {
    world.entities.set(item.id, item);
    world.tethers.set(item.id, length ?? tetherLength(anchor, item, index));
  }
  if (body.scenery !== 2 && body.scenery !== 3 && body.scenery !== 4 && body.scenery !== 5)
    populateScenery(world, body.spider.position, MAX_ENTITIES);
  for (const entity of world.entities.values()) {
    const placement = kindOf(entity.kind)?.placement;
    if (placement && !placement.fits(terrain, entity)) removeEntity(world, entity);
  }
  world.populations = initialPopulations();
  world.populations.set(applePopulation.id, { remaining: body.appleIn, attempts: body.sprouts });
  for (const [id, state] of Object.entries(body.populations ?? {})) {
    world.populations.set(id, { ...state });
  }
  expireEntities(world, body.spider.time);
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
  if (!isFiniteNumber(raw.appleIn) || raw.appleIn < 0 || raw.appleIn > applePopulation.interval)
    return null;
  if (!isFiniteNumber(raw.sprouts) || !Number.isInteger(raw.sprouts)) return null;
  if (raw.sprouts < 0 || raw.sprouts > MAX_SPROUTS) return null;
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.carrying)) return null;
  if (raw.carrying.length > CARRY_LIMIT) return null;
  const count = raw.entities.length + raw.carrying.length;
  if (count < 1 || count > MAX_ENTITIES) return null;
  const entities = raw.entities.map(readEntity);
  const carrying = raw.carrying.map(readCarried);
  if (entities.some((entity) => !entity) || carrying.some((entity) => !entity)) return null;
  const ground = entities as EntityState[];
  const held = carrying as CarriedRecord[];
  for (const placement of islandPlacements) {
    if (
      kindOf(placement.kind)?.home &&
      !ground.some((entity) => entity.id === placement.id && kindOf(entity.kind)?.home)
    )
      return null;
  }
  const ids = new Set<string>();
  for (const entity of [...ground, ...held]) {
    if (ids.has(entity.id)) return null;
    ids.add(entity.id);
  }
  const serials = readEntitySerials(raw.entitySerials);
  if (serials === null) return null;
  const populations = readPopulations(raw.populations);
  if (populations === null) return null;
  const spider = readSpider(raw.spider);
  if (!spider) return null;
  const pending = readPending(raw.pending);
  if (pending === undefined) return null;
  const marks = readMarks(raw.marks);
  if (!marks) return null;
  return {
    ...(raw.scenery === 1 ||
    raw.scenery === 2 ||
    raw.scenery === 3 ||
    raw.scenery === 4 ||
    raw.scenery === 5
      ? { scenery: raw.scenery }
      : {}),
    seed: raw.seed >>> 0,
    appleIn: raw.appleIn as number,
    sprouts: raw.sprouts as number,
    ...(populations ? { populations } : {}),
    ...(serials ? { entitySerials: serials } : {}),
    entities: ground,
    marks,
    carrying: held,
    spider,
    pending,
  };
}

function readEntitySerials(value: unknown): SimBody['entitySerials'] | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries: [string, number][] = [];
  for (const [kind, serial] of Object.entries(value)) {
    if (!kindOf(kind) || !isFiniteNumber(serial) || !Number.isSafeInteger(serial) || serial < 1)
      return null;
    entries.push([kind, serial]);
  }
  return Object.fromEntries(entries);
}

function readPopulations(value: unknown): SimBody['populations'] | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries: [string, PopulationState][] = [];
  for (const [id, state] of Object.entries(value)) {
    const rule = populationRules.find((candidate) => candidate.id === id);
    if (!rule || rule === applePopulation || !state || typeof state !== 'object') return null;
    const { remaining, attempts } = state as Partial<PopulationState>;
    if (!isFiniteNumber(remaining) || remaining < 0 || remaining > rule.interval) return null;
    if (
      !isFiniteNumber(attempts) ||
      !Number.isInteger(attempts) ||
      attempts < 0 ||
      attempts > MAX_SPROUTS
    )
      return null;
    entries.push([id, { remaining, attempts }]);
  }
  return Object.fromEntries(entries);
}

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

function readCarried(value: unknown): CarriedRecord | null {
  const item = readEntity(value);
  if (!item || !kindOf(item.kind)?.carryable) return null;
  const { tetherLength: length } = value as { tetherLength?: unknown };
  if (length === undefined) return item;
  if (!isFiniteNumber(length) || length < MIN_TETHER_LENGTH || length > PLACE_M * 3) return null;
  return { ...item, tetherLength: length };
}

function readEntity(value: unknown): EntityState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== 'string') return null;
  const kind = kindOf(raw.kind);
  if (!kind) return null;
  if (typeof raw.id !== 'string' || !/^[\w.-]{1,64}$/.test(raw.id)) return null;
  if (
    !placed(raw.x, raw.y, raw.z) ||
    !isFiniteNumber(raw.stage) ||
    raw.stage < 0 ||
    raw.stage > Math.max(8, kind.eat?.stages ?? 0)
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
  const expiry = optionalNumber(raw.expiresAt);
  if (expiry === null) return null;
  if (expiry !== undefined) {
    if (expiry < 0 || kind.lifetime === undefined) return null;
    entity.expiresAt = expiry;
  }
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
    lamp: raw.lamp === true,
    feet,
  };
}

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
