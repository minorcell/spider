import { groundSupport } from '@/src/shared/contact';
import { PHYSICS } from '@/src/shared/config';
import { kindOf } from '@/src/shared/kinds';
import { initialControl } from '@/src/shared/control';
import { batchWorldChanges, recordWorldChange, type RemovalCause } from '@/src/shared/changes';
import { detachTether } from '@/src/shared/sim/tether';
import { deadlineAt, freshnessOf } from '@/src/shared/life';
import {
  initialPopulations,
  islandFamilies,
  islandPlacements,
  populationRules,
  type PopulationRule,
  type ScatterOptions,
} from '@/src/shared/islandContent';
import { mulberry32 } from '@/src/shared/noise';
import { blockedAt } from '@/src/shared/sight';
import { stepPhysics } from '@/src/shared/sim/physics';
import type { Block, EntityState, Footprint, WorldState, WorldTime } from '@/src/shared/state';
import { Terrain, TERRAIN } from '@/src/shared/terrain';

export const REACH = 1.2;

export const VIEW_DISTANCE = 24;

export const REACH_Y = 1.6;

export { GRASS, TREES } from '@/src/shared/islandContent';

const MIN_GAP = 3.4;

const WATER = TERRAIN.water;

const BOG_DEPTH_MIN = 0.05;
const BOG_DEPTH_MAX = 0.34;

const SPROUT_CLEAR = 2.2;

const SPROUT_TRIES = 40;

const quantize = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
};

export function restingY(
  terrain: { height(x: number, z: number): number },
  kind: string,
  x: number,
  z: number,
  footprint?: Footprint,
): number {
  const spec = kindOf(kind);
  const rest = spec?.rest ?? 0;
  const body = spec?.physics?.radius ?? 0.2;
  if (body <= 0) return terrain.height(x, z) + rest;
  const radius =
    footprint?.kind === 'circle'
      ? footprint.r
      : footprint?.kind === 'box'
        ? Math.hypot(footprint.hx, footprint.hz)
        : body;
  return groundSupport((px, pz) => terrain.height(px, pz), x, z, radius) + rest;
}

export function indexEntities(entities: Iterable<EntityState>): Map<string, EntityState> {
  const index = new Map<string, EntityState>();
  for (const entity of entities) index.set(entity.id, entity);
  return index;
}

export function createWorld(
  seed = Math.floor(Math.random() * 1_000_000_000),
  terrain = new Terrain(seed),
  wallNowMs = Date.now(),
): WorldState {
  const clock: WorldTime = { tick: 0, simSeconds: 0, wallNowMs };
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const entities: EntityState[] = islandPlacements.map((placement) => ({
    ...makeEntity(
      terrain,
      placement.id,
      placement.kind,
      placement,
      clock,
      placement.footprint ?? kindOf(placement.kind)?.placement?.footprint(placement.id),
    ),
    ...structuredClone(placement),
  }));
  const blocks = propBlocks(entities);
  const placed: { x: number; z: number; kind?: string }[] = [...entities];
  for (const family of islandFamilies) {
    const offset = entities.filter((entity) => entity.kind === family.kind).length;
    entities.push(
      ...scatter(
        rng,
        terrain,
        placed,
        blocks,
        family.kind,
        family.count,
        family.home,
        family,
        offset,
        clock,
        family.initialAgeStep,
      ),
    );
  }
  return {
    seed: terrain.seed,
    clock,
    terrain,
    entities: indexEntities(entities),
    entitySerials: new Map(),
    blocks: propBlocks(entities),
    marks: [],
    tethers: new Map(),
    populations: initialPopulations(),
    physics: PHYSICS,
  };
}

export function addEntity(
  world: WorldState,
  kind: string,
  position: { x: number; z: number },
): EntityState {
  const id = nextPropId(world, kind);
  const entity = makeEntity(
    world.terrain,
    id,
    kind,
    position,
    world.clock,
    kindOf(kind)?.placement?.footprint(id),
  );
  world.entities.set(id, entity);
  world.blocks.push(...propBlocks([entity]));
  recordWorldChange(world, { kind: 'spawned', entity: entity.id });
  return entity;
}

export function removeEntity(
  world: WorldState,
  entity: EntityState,
  cause: RemovalCause = 'despawned',
  actor?: string,
): void {
  if (world.entities.get(entity.id) !== entity) return;
  batchWorldChanges(world, () => {
    const serial = serialOf(entity.id, entity.kind);
    if (serial > (world.entitySerials.get(entity.kind) ?? 0)) {
      world.entitySerials.set(entity.kind, serial);
    }
    world.entities.delete(entity.id);
    if (world.controlledId === entity.id) delete world.controlledId;
    for (const [targetId, relation] of world.tethers) {
      if (relation.sourceId === entity.id || targetId === entity.id)
        detachTether(world, targetId, 'removed');
    }
    world.blocks = world.blocks.filter((block) => (block.owner ?? block.id) !== entity.id);
    recordWorldChange(world, { kind: 'removed', entity: entity.id, cause, actor });
  });
}

export function expireEntities(world: WorldState, previous?: WorldTime): string[] {
  return batchWorldChanges(world, () => {
    const removed: string[] = [];
    for (const entity of world.entities.values()) {
      const freshness = freshnessOf(entity, world.clock);
      if (freshness === 'expired') {
        removeEntity(world, entity, 'expired');
        removed.push(entity.id);
      } else if (previous && freshnessOf(entity, previous) !== freshness) {
        recordWorldChange(world, { kind: 'freshnessChanged', entity: entity.id, to: freshness });
      }
    }
    return removed;
  });
}

function makeEntity(
  terrain: WorldState['terrain'],
  id: string,
  kind: string,
  { x, z }: { x: number; z: number },
  clock: WorldTime,
  footprint?: Footprint,
  ageSeconds = 0,
): EntityState {
  const entity: EntityState = {
    id,
    kind,
    x,
    y: restingY(terrain, kind, x, z, footprint),
    z,
    stage: 0,
  };
  const spec = kindOf(kind);
  if (spec?.control) entity.control = initialControl();
  if (spec?.lifetime) entity.deadline = deadlineAt(spec.lifetime, clock, ageSeconds);
  if (spec?.metabolism) entity.metabolism = { hunger: spec.metabolism.initialHunger };
  if (footprint !== undefined) entity.footprint = footprint;
  return entity;
}

export function grow(world: WorldState, dt: number, avoid?: { x: number; z: number }): void {
  batchWorldChanges(world, () => advancePopulations(world, dt, avoid));
}

function advancePopulations(world: WorldState, dt: number, avoid?: { x: number; z: number }): void {
  for (const rule of populationRules) {
    const clock = world.populations.get(rule.id);
    if (!clock) continue;
    let onGround = 0;
    for (const entity of world.entities.values()) {
      if (entity.kind === rule.kind && !world.tethers.has(entity.id)) onGround += 1;
    }
    clock.remaining = onGround >= rule.count ? rule.interval : Math.max(0, clock.remaining - dt);
    if (clock.remaining > 0) continue;
    clock.remaining = rule.interval;
    sprout(world, rule, clock.attempts++, avoid);
  }
}

function sprout(
  world: WorldState,
  rule: PopulationRule,
  attempt: number,
  avoid: { x: number; z: number } | undefined,
): void {
  const { kind, home, salt } = rule;
  const rng = mulberry32((world.seed ^ salt) + attempt);
  const placed = [...world.entities.values()];
  for (let guard = 0; guard < SPROUT_TRIES; guard++) {
    const spot = roll(rng, world.terrain, placed, world.blocks, kind, home, avoid, rule);
    if (!spot) continue;
    const settled = settle(world.terrain, world.blocks, kind, spot, placed, avoid, rule.gap);
    if (!settled) continue;
    addEntity(world, kind, settled);
    return;
  }
}

function serialOf(id: string, kind: string): number {
  const prefix = `${kind}-`;
  if (!id.startsWith(prefix)) return 0;
  const suffix = Number(id.slice(prefix.length));
  return Number.isSafeInteger(suffix) && suffix > 0 ? suffix : 0;
}

function nextPropId(world: WorldState, kind: string): string {
  let highest = world.entitySerials.get(kind) ?? 0;
  for (const id of world.entities.keys()) highest = Math.max(highest, serialOf(id, kind));
  const serial = highest + 1;
  world.entitySerials.set(kind, serial);
  return `${kind}-${serial}`;
}

export function propBlocks(entities: Iterable<EntityState>): Block[] {
  const blocks: Block[] = [];
  for (const entity of entities) {
    const kind = kindOf(entity.kind);
    if (kind?.physics?.solid === false) continue;
    const boxes = typeof kind?.boxes === 'function' ? kind.boxes(entity) : kind?.boxes;
    for (const box of boxes ?? []) {
      blocks.push({
        id: `${entity.id}/${box.id}`,
        owner: entity.id,
        kind: entity.kind,
        minX: entity.x + box.minX,
        maxX: entity.x + box.maxX,
        minZ: entity.z + box.minZ,
        maxZ: entity.z + box.maxZ,
        height: entity.y + box.height,
      });
    }
    const spec = typeof kind?.block === 'function' ? kind.block(entity) : kind?.block;
    if (!spec) continue;
    const footprint = entity.footprint;
    const radius =
      footprint == null
        ? 0.4
        : footprint.kind === 'circle'
          ? footprint.r
          : Math.min(footprint.hx, footprint.hz);
    const half = spec.radius * radius;
    blocks.push({
      id: entity.id,
      kind: entity.kind,
      minX: entity.x - half,
      maxX: entity.x + half,
      minZ: entity.z - half,
      maxZ: entity.z + half,
      height: entity.y + spec.height,
    });
  }
  return blocks;
}

function scatter(
  rng: () => number,
  terrain: WorldState['terrain'],
  placed: { x: number; z: number; kind?: string }[],
  blocks: readonly Block[],
  kind: string,
  count: number,
  minFromHome: number,
  options: ScatterOptions,
  offset: number,
  clock: WorldTime,
  initialAgeStep = 0,
): EntityState[] {
  const entities: EntityState[] = [];
  let guard = 0;
  while (entities.length < count && guard < 1000) {
    guard += 1;
    const spot = roll(rng, terrain, placed, blocks, kind, minFromHome, undefined, options);
    if (!spot) continue;
    const settled = settle(terrain, blocks, kind, spot, placed, undefined, options.gap);
    if (!settled) continue;
    const id = `${kind}-${offset + entities.length + 1}`;
    const placement = kindOf(kind)?.placement;
    const footprint =
      options.radius != null
        ? {
            kind: 'circle' as const,
            r: quantize(options.radius[0] + rng() * (options.radius[1] - options.radius[0])),
          }
        : placement?.footprint(id);
    const entity = makeEntity(
      terrain,
      id,
      kind,
      settled,
      clock,
      footprint,
      entities.length * initialAgeStep,
    );
    if (placement && !placement.fits(terrain, entity)) continue;
    placed.push(entity);
    entities.push(entity);
  }
  return entities;
}

const SETTLE_STEPS = 30;
const SETTLE_DT = 1 / 15;

export function settle(
  terrain: { height(x: number, z: number): number },
  blocks: readonly Block[],
  kind: string,
  start: { x: number; z: number },
  placed: { x: number; z: number; kind?: string }[],
  avoid?: { x: number; z: number },
  gap = MIN_GAP,
): { x: number; z: number } | null {
  const spec = kindOf(kind)?.physics;
  const depth = WATER - terrain.height(start.x, start.z);
  const wet = kindOf(kind)?.wet === true;
  if (wet ? depth < BOG_DEPTH_MIN || depth > BOG_DEPTH_MAX : depth >= 0) return null;
  if (!spec?.loose) return { x: start.x, z: start.z };

  const entity: EntityState = {
    id: 'settle',
    kind,
    x: start.x,
    y: terrain.height(start.x, start.z),
    z: start.z,
    stage: 0,
    vx: 0,
    vz: 0,
  };
  const scratch: WorldState = {
    seed: 0,
    clock: { tick: 0, simSeconds: 0, wallNowMs: 0 },
    terrain,
    entities: indexEntities([entity]),
    entitySerials: new Map(),
    blocks: [...blocks],
    marks: [],
    tethers: new Map(),
    populations: new Map(),
    physics: PHYSICS,
  };
  const run = (): void => {
    for (let step = 0; step < SETTLE_STEPS; step++) {
      stepPhysics(scratch, undefined, SETTLE_DT);
      if (entity.vx === 0 && entity.vz === 0) return;
    }
  };
  run();
  const lower = lowerAround(terrain, entity.x, entity.z);
  if (lower) {
    entity.x = lower.x;
    entity.z = lower.z;
    entity.y = terrain.height(lower.x, lower.z);
    entity.vx = 0;
    entity.vy = 0;
    entity.vz = 0;
    run();
  }

  const x = quantize(entity.x);
  const z = quantize(entity.z);
  const slope = Math.hypot(
    terrain.height(x + 0.5, z) - terrain.height(x - 0.5, z),
    terrain.height(x, z + 0.5) - terrain.height(x, z - 0.5),
  );
  const asleep = entity.vx === 0 && entity.vz === 0;
  if (asleep && slope > PHYSICS.sleepSlope) return null;
  const restDepth = WATER - terrain.height(x, z);
  if (restDepth >= 0) return null;
  if (Math.hypot(x, z) > TERRAIN.island * 0.7) return null;
  if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < SPROUT_CLEAR) return null;
  if (placed.some((point) => Math.hypot(point.x - x, point.z - z) < gap)) return null;
  if (blockedAt(x, z, blocks, spec.radius)) return null;
  return { x, z };
}

function lowerAround(
  terrain: { height(x: number, z: number): number },
  x: number,
  z: number,
): { x: number; z: number } | null {
  let lowest = terrain.height(x, z);
  let spot: { x: number; z: number } | null = null;
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI * 2;
    const px = x + Math.cos(angle) * 0.5;
    const pz = z + Math.sin(angle) * 0.5;
    const h = terrain.height(px, pz);
    if (h >= lowest - 0.03) continue;
    lowest = h;
    spot = { x: px, z: pz };
  }
  return spot;
}

function roll(
  rng: () => number,
  terrain: { height(x: number, z: number): number },
  placed: { x: number; z: number; kind?: string }[],
  blocks: readonly Block[],
  kind: string,
  minFromHome: number,
  avoid?: { x: number; z: number },
  options: ScatterOptions = {},
): { x: number; z: number } | null {
  const x = quantize((rng() * 2 - 1) * TERRAIN.island * 0.8);
  const z = quantize((rng() * 2 - 1) * TERRAIN.island * 0.8);
  const radius = Math.hypot(x, z);
  if (radius > TERRAIN.island * 0.72) return null;
  if (
    placed.some(
      (point) =>
        point.kind &&
        kindOf(point.kind)?.home &&
        Math.hypot(x - point.x, z - point.z) < minFromHome,
    )
  )
    return null;
  const ground = terrain.height(x, z);
  const depth = WATER - ground;
  const wet = kindOf(kind)?.wet === true;
  if (wet ? depth < BOG_DEPTH_MIN || depth > BOG_DEPTH_MAX : depth >= 0) return null;
  const slope =
    Math.hypot(terrain.height(x + 0.8, z) - ground, terrain.height(x, z + 0.8) - ground) / 0.8;
  if (slope > 0.32) return null;
  const gap = options.gap ?? MIN_GAP;
  if (placed.some((point) => Math.hypot(point.x - x, point.z - z) < gap)) return null;
  if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < SPROUT_CLEAR) return null;
  const probe = kindOf(kind)?.placement?.probe ?? 0.2;
  if (blockedAt(x, z, blocks, probe)) return null;
  return { x, z };
}
