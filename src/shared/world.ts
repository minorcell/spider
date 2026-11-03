import { PHYSICS } from './config.js';
import { kindOf } from './kinds.js';
import { mulberry32 } from './noise.js';
import { blockedAt } from './sight.js';
import { stepPhysics } from './sim/physics.js';
import type { Block, EntityState, Footprint, WorldState } from './state.js';
import { Terrain, TERRAIN } from './terrain.js';

/** How close you must be, horizontally, to act on something. */
export const REACH = 1.2;

/** How far a look reaches when you do not ask for less. There is no farther look. */
export const VIEW_DISTANCE = 16;

/** How far you see once you have walked into grass. */
export const GRASS_VIEW = 4.5;

/** Something this far above or below you cannot be acted on. */
export const REACH_Y = 1.6;

const APPLES = 20;
const GRASS = 24;
const MIN_GAP = 3.4;

/** Quiet seconds after the ground is short an apple, before one more grows. */
export const APPLE_EVERY = 24;

/** Do not grow an apple into the spider's reach. */
const SPROUT_CLEAR = 2.2;

const SPROUT_TRIES = 40;

const quantize = (value: number): number => Math.round(value * 10) / 10;

/** A hair above the ground triangle, so the contact edge does not z-fight into the fill. */
const CLEARANCE = 0.03;

/**
 * Height to sit a prop on. A kind with no contact radius anchors at the center
 * sample. Anything with a radius is lifted to the highest ground under that disc.
 */
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
  let top = terrain.height(x, z);
  for (const ring of [radius * 0.5, radius]) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      top = Math.max(top, terrain.height(x + Math.cos(angle) * ring, z + Math.sin(angle) * ring));
    }
  }
  return top + rest + CLEARANCE;
}

/**
 * A seeded island. You are born in the nest. Apples can be eaten or carried.
 * Grass can be walked through. The nest walls cannot.
 * The same seed builds the same place. Eaten apples stay gone; the island
 * grows a new one elsewhere once the ground has been short of them for a while.
 */
export function createWorld(
  seed = Math.floor(Math.random() * 1_000_000_000),
  terrain = new Terrain(seed),
): WorldState {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const blocks = nestBlocks();
  const placed: { x: number; z: number }[] = [];
  const entities: EntityState[] = [
    { id: 'home', kind: 'nest', x: 0, y: 0.02, z: 0, stage: 0 },
    ...scatter(rng, terrain, placed, blocks, 'grass', GRASS, 6.5),
    ...scatter(rng, terrain, placed, blocks, 'apple', APPLES, 6),
  ];
  return {
    seed: terrain.seed,
    terrain,
    entities,
    blocks,
    marks: [],
    carrying: [],
    appleIn: APPLE_EVERY,
    sprouts: 0,
    physics: PHYSICS,
  };
}

/**
 * Grow at most one apple when fewer than the original handful are on the ground.
 * Carried apples do not count: they have left the ground. The same seed and the
 * same number of tries put the new apple in the same place.
 */
export function grow(world: WorldState, dt: number, avoid?: { x: number; z: number }): void {
  if (world.appleIn == null || world.sprouts == null) return;
  const onGround = world.entities.filter((entity) => entity.kind === 'apple').length;
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
    /* v8 ignore next */
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

/** The next `kind-N` id, looking at the ground and the back. Non-numeric suffixes are skipped. */
export function nextPropId(world: Pick<WorldState, 'entities' | 'carrying'>, kind: string): string {
  const taken = [...world.entities, ...world.carrying].filter((item) => item.kind === kind);
  const next =
    taken.reduce((max, item) => {
      const suffix = Number(item.id.slice(kind.length + 1));
      return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
    }, 0) + 1;
  return `${kind}-${next}`;
}

/**
 * The nest is a round earth bank with a door on -Z, the way you face at birth.
 * The visual mound is built from the same radius, so the wall you hit sits at
 * the foot of the slope. A ring of AABBs is the cheapest way to keep the
 * serialized world the same shape it always was.
 */
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

function scatter(
  rng: () => number,
  terrain: Terrain,
  placed: { x: number; z: number }[],
  blocks: readonly Block[],
  kind: string,
  count: number,
  minFromHome: number,
): EntityState[] {
  const entities: EntityState[] = [];
  let guard = 0;
  while (entities.length < count && guard < 1000) {
    guard += 1;
    const spot = roll(rng, terrain, placed, blocks, kind, minFromHome);
    if (!spot) continue;
    const settled = settle(terrain, blocks, kind, spot, placed);
    if (!settled) continue;
    const footprint = kind === 'grass' ? { kind: 'circle' as const, r: 3.2 } : undefined;
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

/** Water fills every hollow below this level, so nothing is placed in it. */
const WATER = TERRAIN.water;
const SETTLE_STEPS = 30;
const SETTLE_DT = 1 / 15;

/**
 * Where a placed thing comes to rest. Fixed kinds stay on the spot they were
 * given. Loose kinds run the same solver the island steps every frame, then
 * the spot is kept only if it is dry, on land, clear of walls and neighbors.
 */
export function settle(
  terrain: { height(x: number, z: number): number },
  blocks: readonly Block[],
  kind: string,
  start: { x: number; z: number },
  placed: { x: number; z: number }[],
  avoid?: { x: number; z: number },
): { x: number; z: number } | null {
  const spec = kindOf(kind)?.physics;
  if (terrain.height(start.x, start.z) <= WATER) return null;
  if (!spec?.loose) return { x: start.x, z: start.z };

  const entity: EntityState = {
    id: 'settle',
    kind,
    x: start.x,
    y: 0,
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
  // A crest is flat in the center and lower all around. Step off it and settle again.
  const lower = lowerAround(terrain, entity.x, entity.z);
  if (lower) {
    entity.x = lower.x;
    entity.z = lower.z;
    entity.vx = 0;
    entity.vz = 0;
    run();
  }

  const x = quantize(entity.x);
  const z = quantize(entity.z);
  // A wall stops a loose body while the ground under it is still steep.
  // That is not a rest. A slope it is still crossing can be placed; the solver
  // keeps moving it after the world starts.
  const slope = Math.hypot(
    terrain.height(x + 0.5, z) - terrain.height(x - 0.5, z),
    terrain.height(x, z + 0.5) - terrain.height(x, z - 0.5),
  );
  const asleep = entity.vx === 0 && entity.vz === 0;
  if (asleep && slope > PHYSICS.sleepSlope) return null;
  if (terrain.height(x, z) <= WATER) return null;
  if (Math.hypot(x, z) > TERRAIN.island * 0.7) return null;
  if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < SPROUT_CLEAR) return null;
  if (placed.some((point) => Math.hypot(point.x - x, point.z - z) < MIN_GAP)) return null;
  if (blockedAt(x, z, blocks, spec.radius)) return null;
  return { x, z };
}

/** The lowest neighbor when the center is a crest. Null on a hollow or a plain. */
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

/** One scatter try. Null when the point is home, steep, crowded, or under the spider. */
function roll(
  rng: () => number,
  terrain: { height(x: number, z: number): number },
  placed: { x: number; z: number }[],
  blocks: readonly Block[],
  kind: string,
  minFromHome: number,
  avoid?: { x: number; z: number },
): { x: number; z: number } | null {
  const x = quantize((rng() * 2 - 1) * TERRAIN.island * 0.8);
  const z = quantize((rng() * 2 - 1) * TERRAIN.island * 0.8);
  const radius = Math.hypot(x, z);
  if (radius < minFromHome || radius > TERRAIN.island * 0.72) return null;
  const ground = terrain.height(x, z);
  if (ground <= WATER) return null;
  const slope =
    Math.hypot(terrain.height(x + 0.8, z) - ground, terrain.height(x, z + 0.8) - ground) / 0.8;
  if (slope > 0.32) return null;
  const gap = kind === 'grass' ? 6 : MIN_GAP;
  if (placed.some((point) => Math.hypot(point.x - x, point.z - z) < gap)) return null;
  if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < SPROUT_CLEAR) return null;
  const probe = kind === 'grass' ? 3.2 : 0.2;
  /* v8 ignore next */
  if (blockedAt(x, z, blocks, probe)) return null;
  return { x, z };
}
