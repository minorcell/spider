import { grassOnDryGround, grassRadius } from './grass.js';
import { groundSupport } from './contact.js';
import { PHYSICS } from './config.js';
import { kindOf } from './kinds.js';
import { mulberry32 } from './noise.js';
import { blockedAt } from './sight.js';
import { stepPhysics } from './sim/physics.js';
import type { Block, EntityState, Footprint, WorldState } from './state.js';
import { Terrain, TERRAIN } from './terrain.js';

export const REACH = 1.2;

export const VIEW_DISTANCE = 16;

export const GRASS_VIEW = 4.5;

export const REACH_Y = 1.6;

const APPLES = 20;
export const GRASS = 32;
export const TREES = 24;
const STONES = 10;
const BOG_STONES = 5;
const MIN_GAP = 3.4;

const TREE_GAP = 2.6;
const STONE_GAP = 2.8;
const BOG_GAP = 2.4;
const TREE_RADIUS = [0.32, 0.56] as const;
const STONE_RADIUS = [0.5, 1.15] as const;
const BOG_RADIUS = [0.55, 0.95] as const;

const WATER = TERRAIN.water;

const BOG_DEPTH_MIN = 0.05;
const BOG_DEPTH_MAX = 0.34;

interface ScatterOptions {
  readonly gap?: number;
  readonly radius?: readonly [number, number];
}

export const APPLE_EVERY = 24;

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

export function createWorld(
  seed = Math.floor(Math.random() * 1_000_000_000),
  terrain = new Terrain(seed),
): WorldState {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const blocks = nestBlocks();
  const placed: { x: number; z: number }[] = [];
  const entities: EntityState[] = [
    { id: 'home', kind: 'nest', x: 0, y: 0.02, z: 0, stage: 0 },
    ...scatter(rng, terrain, placed, blocks, 'grass', GRASS, 6.5, { gap: 5 }),
    ...scatter(rng, terrain, placed, blocks, 'apple', APPLES, 6),
    ...scatter(rng, terrain, placed, blocks, 'tree', TREES, 8.5, {
      gap: TREE_GAP,
      radius: TREE_RADIUS,
    }),
    ...scatter(rng, terrain, placed, blocks, 'stone', STONES, 6.2, {
      gap: STONE_GAP,
      radius: STONE_RADIUS,
    }),
    ...scatter(rng, terrain, placed, blocks, 'bog-stone', BOG_STONES, 7, {
      gap: BOG_GAP,
      radius: BOG_RADIUS,
    }),
  ];
  return {
    seed: terrain.seed,
    terrain,
    entities,
    blocks: [...blocks, ...propBlocks(entities)],
    marks: [],
    carrying: [],
    appleIn: APPLE_EVERY,
    sprouts: 0,
    physics: PHYSICS,
  };
}

export function grow(world: WorldState, dt: number, avoid?: { x: number; z: number }): void {
  if (world.appleIn == null || world.sprouts == null) return;
  let onGround = 0;
  for (const entity of world.entities) if (entity.kind === 'apple') onGround += 1;
  if (onGround >= APPLES) {
    world.appleIn = APPLE_EVERY;
    return;
  }
  world.appleIn -= dt;
  if (world.appleIn > 0) return;
  world.appleIn = APPLE_EVERY;
  const salt = world.sprouts;
  world.sprouts += 1;
  const rng = mulberry32((world.seed ^ 0x51f15e) + salt);
  const placed = world.entities.map((entity) => ({ x: entity.x, z: entity.z }));
  for (let guard = 0; guard < SPROUT_TRIES; guard++) {
    const spot = roll(rng, world.terrain, placed, world.blocks, 'apple', 6, avoid);
    if (!spot) continue;
    const settled = settle(world.terrain, world.blocks, 'apple', spot, placed, avoid);
    if (!settled) continue;
    world.entities.push({
      id: nextPropId(world, 'apple'),
      kind: 'apple',
      x: settled.x,
      y: restingY(world.terrain, 'apple', settled.x, settled.z),
      z: settled.z,
      stage: 0,
    });
    return;
  }
}

export function nextPropId(world: Pick<WorldState, 'entities' | 'carrying'>, kind: string): string {
  const taken = [...world.entities, ...world.carrying].filter((item) => item.kind === kind);
  const next =
    taken.reduce((max, item) => {
      const suffix = Number(item.id.slice(kind.length + 1));
      return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
    }, 0) + 1;
  return `${kind}-${next}`;
}

export function nestBlocks(): Block[] {
  const segments = 22;
  const radius = 2.62;
  const half = 0.42;
  const thickness = 0.24;
  const door = -Math.PI / 2;
  const gap = 0.62;
  const blocks: Block[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const away = Math.abs(Math.atan2(Math.sin(angle - door), Math.cos(angle - door)));
    if (away < gap) continue;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const ex = Math.abs(Math.sin(angle) * half) + Math.abs(Math.cos(angle) * thickness);
    const ez = Math.abs(Math.cos(angle) * half) + Math.abs(Math.sin(angle) * thickness);
    blocks.push({
      id: `nest-ring-${i}`,
      minX: cx - ex,
      maxX: cx + ex,
      minZ: cz - ez,
      maxZ: cz + ez,
      height: 1,
    });
  }
  return blocks;
}

export function propBlocks(entities: readonly EntityState[]): Block[] {
  const blocks: Block[] = [];
  for (const entity of entities) {
    const spec = kindOf(entity.kind)?.block;
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
      minX: entity.x - half,
      maxX: entity.x + half,
      minZ: entity.z - half,
      maxZ: entity.z + half,
      height: entity.y + spec.height,
    });
  }
  return blocks;
}

export function populateScenery(
  world: WorldState,
  avoid: { x: number; z: number },
  capacity: number,
): void {
  const rng = mulberry32(world.seed ^ 0x7363656e);
  const placed = [...world.entities, ...world.carrying, avoid];
  const families = [
    { kind: 'grass', count: GRASS, home: 6.5, gap: 5, radius: undefined },
    { kind: 'tree', count: TREES, home: 8.5, gap: TREE_GAP, radius: TREE_RADIUS },
    { kind: 'stone', count: STONES, home: 6.2, gap: STONE_GAP, radius: STONE_RADIUS },
    { kind: 'bog-stone', count: BOG_STONES, home: 7, gap: BOG_GAP, radius: BOG_RADIUS },
  ];
  for (const family of families) {
    const existing = world.entities.filter((entity) => entity.kind === family.kind).length;
    const count = Math.min(
      family.count - existing,
      capacity - world.entities.length - world.carrying.length,
    );
    const added = scatter(
      rng,
      world.terrain,
      placed,
      world.blocks,
      family.kind,
      count,
      family.home,
      family,
    );
    for (const entity of added) {
      entity.id = nextPropId(world, family.kind);
      world.entities.push(entity);
    }
    world.blocks.push(...propBlocks(added));
  }
}

function scatter(
  rng: () => number,
  terrain: WorldState['terrain'],
  placed: { x: number; z: number }[],
  blocks: readonly Block[],
  kind: string,
  count: number,
  minFromHome: number,
  options: ScatterOptions = {},
): EntityState[] {
  const entities: EntityState[] = [];
  let guard = 0;
  while (entities.length < count && guard < 1000) {
    guard += 1;
    const spot = roll(rng, terrain, placed, blocks, kind, minFromHome, undefined, options);
    if (!spot) continue;
    const settled = settle(terrain, blocks, kind, spot, placed);
    if (!settled) continue;
    const footprint =
      options.radius != null
        ? {
            kind: 'circle' as const,
            r: quantize(options.radius[0] + rng() * (options.radius[1] - options.radius[0])),
          }
        : kind === 'grass'
          ? { kind: 'circle' as const, r: grassRadius(`grass-${entities.length + 1}`) }
          : undefined;
    if (
      kind === 'grass' &&
      footprint?.kind === 'circle' &&
      !grassOnDryGround((x, z) => terrain.height(x, z), settled.x, settled.z, footprint.r)
    )
      continue;
    placed.push(settled);
    entities.push({
      id: `${kind}-${entities.length + 1}`,
      kind,
      x: settled.x,
      y: restingY(terrain, kind, settled.x, settled.z, footprint),
      z: settled.z,
      stage: 0,
      footprint,
    });
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
  placed: { x: number; z: number }[],
  avoid?: { x: number; z: number },
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
    terrain,
    entities: [entity],
    blocks: [...blocks],
    marks: [],
    carrying: [],
    physics: PHYSICS,
  };
  const far = { x: 1e6, z: 1e6, speed: 0 };
  const run = (): void => {
    for (let step = 0; step < SETTLE_STEPS; step++) {
      stepPhysics(scratch, far, SETTLE_DT);
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
  if (placed.some((point) => Math.hypot(point.x - x, point.z - z) < MIN_GAP)) return null;
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
  placed: { x: number; z: number }[],
  blocks: readonly Block[],
  kind: string,
  minFromHome: number,
  avoid?: { x: number; z: number },
  options: ScatterOptions = {},
): { x: number; z: number } | null {
  const x = quantize((rng() * 2 - 1) * TERRAIN.island * 0.8);
  const z = quantize((rng() * 2 - 1) * TERRAIN.island * 0.8);
  const radius = Math.hypot(x, z);
  if (radius < minFromHome || radius > TERRAIN.island * 0.72) return null;
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
  const probe = kind === 'grass' ? 3.2 : 0.2;
  if (blockedAt(x, z, blocks, probe)) return null;
  return { x, z };
}
