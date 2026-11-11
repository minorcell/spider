import { recordWorldChange } from '@/src/shared/changes';
import { captureWorldData, type WorldData } from '@/src/shared/worldView';
import { MARK_LIMIT, MARK_NAME_MAX, MARK_NOTE_MAX } from '@/src/shared/config';
import type { ControlSpec, ControlState } from '@/src/shared/control';
import { kindOf } from '@/src/shared/kinds';
import type { Deadline } from '@/src/shared/life';
import { populationRules, type PopulationState } from '@/src/shared/islandContent';
import type {
  EntityState,
  Footprint,
  PlaceMark,
  TetherRelation,
  WorldState,
  WorldTime,
} from '@/src/shared/state';
import { expireEntities, indexEntities, propBlocks } from '@/src/shared/world';
import { Terrain } from '@/src/shared/terrain';
import { attachmentFailure } from '@/src/shared/sim/tether';
import { bindController } from '@/src/shared/sim/bindController';
import type { Controller } from '@/src/shared/sim/controller';

export const FORMAT = 4;
export const MAX_ENTITIES = 160;
export const MAX_PENDING = 4000;
export const MAX_JSON = 64_000;
const MAX_SPROUTS = 1_000_000;
const MAX_TOOL = 32;
const PLACE_M = 1_000_000;
const PLACE_Y = 1_000;

export interface SimBody extends WorldData {
  controlledId: string;
  pending: { text: string; tool: string | null } | null;
}

export interface WorldRecord extends SimBody {
  id: 'current';
  format: 4;
  savedAt: number;
  day: string;
  owner: string;
  seq: number;
  leaseUntil: number;
}

export type Classify =
  | { status: 'ok'; record: WorldRecord }
  | { status: 'malformed' | 'obsolete' | 'format' | 'empty' };

export interface Restorable {
  cancel(): void;
  adopt(body: SimBody): void;
  readonly world: WorldState;
  readonly actor: Controller;
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
  return {
    ...captureWorldData(world),
    controlledId: world.controlledId!,
    pending: cleanPending(pending),
  };
}

/** Build and validate a complete candidate before cancelling actions or replacing live state. */
export function applyBody(
  session: Restorable,
  body: SimBody,
  terrain = new Terrain(body.seed),
  wallNowMs = Date.now(),
): void {
  if (!Number.isFinite(wallNowMs) || wallNowMs < 0) throw new Error('Invalid world time');
  const decoded = bodyOf(body as unknown as Record<string, unknown>);
  if (!decoded) throw new Error('Invalid world snapshot');
  const entities = indexEntities(decoded.entities);
  const actor = entities.get(decoded.controlledId)!;
  const candidate: WorldState = {
    seed: terrain.seed,
    clock: { ...decoded.clock, wallNowMs },
    terrain,
    entities,
    controlledId: actor.id,
    blocks: propBlocks(entities.values()),
    marks: decoded.marks,
    tethers: new Map(decoded.tethers.map((relation) => [relation.targetId, relation])),
    populations: new Map(Object.entries(decoded.populations)),
    entitySerials: new Map(Object.entries(decoded.entitySerials)),
    physics: session.world.physics,
  };
  expireEntities(candidate);
  if (!candidate.entities.has(actor.id)) throw new Error('Controlled entity expired');
  session.cancel();
  Object.assign(session.world, candidate);
  session.actor.bindEntity(actor);
  bindController(session.actor, session.world);
  recordWorldChange(session.world, { kind: 'restored' });
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
  if (raw.format < FORMAT) return { status: 'obsolete' };
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
  if (!Array.isArray(raw.entities) || raw.entities.length < 1 || raw.entities.length > MAX_ENTITIES)
    return null;
  const entities: EntityState[] = [];
  const index = new Map<string, EntityState>();
  for (const value of raw.entities) {
    const entity = readEntity(value);
    if (!entity || index.has(entity.id)) return null;
    index.set(entity.id, entity);
    entities.push(entity);
  }
  if (typeof raw.controlledId !== 'string' || !index.get(raw.controlledId)?.control) return null;
  if (!Array.isArray(raw.tethers) || raw.tethers.length > entities.length) return null;
  const relations = { entities: index, tethers: new Map<string, TetherRelation>() };
  for (const value of raw.tethers) {
    if (!value || typeof value !== 'object') return null;
    const { sourceId, targetId, length } = value as Partial<TetherRelation>;
    if (typeof sourceId !== 'string' || typeof targetId !== 'string') return null;
    if (attachmentFailure(relations, sourceId, targetId)) return null;
    const spec = kindOf(index.get(sourceId)!.kind)!.tether!;
    if (!isFiniteNumber(length) || length < spec.minLength || length > PLACE_M * 3) return null;
    relations.tethers.set(targetId, { sourceId, targetId, length });
  }
  const tethers = [...relations.tethers.values()];
  const clock = readClock(raw.clock);
  const serials = readEntitySerials(raw.entitySerials);
  const populations = readPopulations(raw.populations);
  const pending = readPending(raw.pending);
  const marks = readMarks(raw.marks);
  if (!clock || !serials || !populations || pending === undefined || !marks) return null;
  return {
    seed: raw.seed >>> 0,
    clock,
    controlledId: raw.controlledId,
    entities,
    entitySerials: serials,
    populations,
    marks,
    tethers,
    pending,
  };
}

function readClock(value: unknown): WorldTime | null {
  if (!value || typeof value !== 'object') return null;
  const { tick, simSeconds, wallNowMs } = value as Partial<WorldTime>;
  if (!Number.isSafeInteger(tick) || tick! < 0) return null;
  if (!isFiniteNumber(simSeconds) || simSeconds < 0) return null;
  if (!isFiniteNumber(wallNowMs) || wallNowMs < 0) return null;
  return { tick: tick!, simSeconds, wallNowMs };
}

function readEntitySerials(value: unknown): SimBody['entitySerials'] | null {
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries: [string, PopulationState][] = [];
  for (const [id, state] of Object.entries(value)) {
    const rule = populationRules.find((candidate) => candidate.id === id);
    if (!rule || !state || typeof state !== 'object') return null;
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
  if (typeof raw.kind !== 'string') return null;
  const kind = kindOf(raw.kind);
  if (!kind) return null;
  if (typeof raw.id !== 'string' || !/^[\w.-]{1,64}$/.test(raw.id)) return null;
  if (
    !placed(raw.x, raw.y, raw.z) ||
    !isFiniteNumber(raw.stage) ||
    raw.stage < 0 ||
    !Number.isInteger(raw.stage) ||
    raw.stage > (kind.eat?.bites ?? 0)
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
  if (kind.control) {
    const control = readControl(raw.control, kind.control);
    if (!control) return null;
    entity.control = control;
  } else if (raw.control !== undefined) return null;
  if (kind.lifetime) {
    const deadline = readDeadline(raw.deadline);
    if (!deadline) return null;
    entity.deadline = deadline;
  } else if (raw.deadline !== undefined) return null;
  if (kind.metabolism) {
    const hunger = (raw.metabolism as { hunger?: unknown } | null)?.hunger;
    if (!isFiniteNumber(hunger) || hunger < 0 || hunger > kind.metabolism.maxHunger) return null;
    entity.metabolism = { hunger };
  } else if (raw.metabolism !== undefined) return null;
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

function readDeadline(raw: unknown): Deadline | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const wall = value.clock === 'wall';
  if (!wall && value.clock !== 'simulation') return null;
  const rots = wall ? value.rotsAtMs : value.rotsAtSeconds;
  const expires = wall ? value.expiresAtMs : value.expiresAtSeconds;
  if (!isFiniteNumber(rots) || !isFiniteNumber(expires) || rots < 0 || expires < rots) return null;
  return wall
    ? { clock: 'wall', rotsAtMs: rots, expiresAtMs: expires }
    : { clock: 'simulation', rotsAtSeconds: rots, expiresAtSeconds: expires };
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

function readControl(value: unknown, spec: ControlSpec): ControlState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as ControlState;
  for (const key of ['time', 'yaw', 'yawRate', 'speed', 'height', 'fall', 'stuckFor'] as const) {
    if (!isFiniteNumber(raw[key])) return null;
  }
  if (
    raw.time < 0 ||
    raw.fall < 0 ||
    raw.stuckFor < 0 ||
    raw.height < spec.heightMin ||
    raw.height > spec.heightMax
  )
    return null;
  if (typeof raw.lamp !== 'boolean' || !['clear', 'solid', 'steep'].includes(raw.halt)) return null;
  return {
    time: raw.time,
    yaw: raw.yaw,
    yawRate: raw.yawRate,
    speed: raw.speed,
    height: raw.height,
    fall: raw.fall,
    stuckFor: raw.stuckFor,
    halt: raw.halt,
    lamp: raw.lamp,
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
