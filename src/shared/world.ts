import { kindOf } from './kinds.js';
import { mulberry32 } from './noise.js';
import { blockedAt } from './sight.js';
import type { Block, EntityState, Footprint, WorldState } from './state.js';
import { surfaceAt, Terrain, TERRAIN } from './terrain.js';

/** How close you must be, horizontally, to act on something. */
export const REACH = 1.2;

/** How far a look reaches when you do not ask for less. There is no farther look. */
export const VIEW_DISTANCE = 16;

/** How far you see once you have walked into grass. */
export const GRASS_VIEW = 4.5;

/** Something this far above or below you cannot be acted on. */
export const REACH_Y = 1.6;

const APPLES = 5;
const GRASS = 5;
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
 * Height to sit a prop on. Grass is a patch draped per blade, so its anchor is
 * the center. Anything solid is lifted to the highest ground under its footprint.
 */
export function restingY(
  terrain: { height(x: number, z: number): number },
  kind: string,
  x: number,
  z: number,
  footprint?: Footprint,
): number {
  const rest = kindOf(kind)?.rest ?? 0;
  if (kind === 'grass' || kind === 'nest') return terrain.height(x, z) + rest;
  const radius =
    footprint?.kind === 'circle'
      ? footprint.r
      : footprint?.kind === 'box'
        ? Math.hypot(footprint.hx, footprint.hz)
        : kind === 'apple'
          ? 0.36
          : 0.2;
  let top = surfaceAt(terrain.height.bind(terrain), x, z);
  for (const ring of [radius * 0.5, radius]) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      top = Math.max(
        top,
        surfaceAt(
          terrain.height.bind(terrain),
          x + Math.cos(angle) * ring,
          z + Math.sin(angle) * ring,
        ),
      );
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
export function createWorld(seed = Math.floor(Math.random() * 1_000_000_000)): WorldState {
  const terrain = new Terrain(seed);
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
    carrying: [],
    appleIn: APPLE_EVERY,
    sprouts: 0,
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
    world.entities.push({
      id: nextPropId(world, 'apple'),
      kind: 'apple',
      x: spot.x,
      y: restingY(world.terrain, 'apple', spot.x, spot.z),
      z: spot.z,
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

/** The nest is a low square of walls with a door on -Z, the way you face at birth. */
export function nestBlocks(): Block[] {
  const o = 2.35;
  const t = 0.5;
  const door = 1.25;
  const h = 0.72;
  const wall = (id: string, minX: number, maxX: number, minZ: number, maxZ: number): Block => ({
    id,
    minX,
    maxX,
    minZ,
    maxZ,
    height: h,
  });
  return [
    wall('nest-w', -o - t, -o, -o - t, o + t),
    wall('nest-e', o, o + t, -o - t, o + t),
    wall('nest-n', -o, o, o, o + t),
    wall('nest-s-w', -o, -door, -o - t, -o),
    wall('nest-s-e', door, o, -o - t, -o),
  ];
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
  while (entities.length < count && guard < 600) {
    guard += 1;
    const spot = roll(rng, terrain, placed, blocks, kind, minFromHome);
    if (!spot) continue;
    const footprint = kind === 'grass' ? { kind: 'circle' as const, r: 3.2 } : undefined;
    placed.push(spot);
    entities.push({
      id: `${kind}-${entities.length + 1}`,
      kind,
      x: spot.x,
      y: restingY(terrain, kind, spot.x, spot.z, footprint),
      z: spot.z,
      stage: 0,
      footprint,
    });
  }
  return entities;
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
  const x = quantize((rng() * 2 - 1) * TERRAIN.island * 0.62);
  const z = quantize((rng() * 2 - 1) * TERRAIN.island * 0.62);
  const radius = Math.hypot(x, z);
  if (radius < minFromHome || radius > TERRAIN.island * 0.6) return null;
  const ground = terrain.height(x, z);
  const slope =
    Math.hypot(terrain.height(x + 0.8, z) - ground, terrain.height(x, z + 0.8) - ground) / 0.8;
  if (slope > 0.32) return null;
  const gap = kind === 'grass' ? 7 : MIN_GAP;
  if (placed.some((point) => Math.hypot(point.x - x, point.z - z) < gap)) return null;
  if (avoid && Math.hypot(avoid.x - x, avoid.z - z) < SPROUT_CLEAR) return null;
  const probe = kind === 'grass' ? 3.2 : 0.2;
  /* v8 ignore next */
  if (blockedAt(x, z, blocks, probe)) return null;
  return { x, z };
}
