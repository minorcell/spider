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
 * The same seed builds the same place.
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
  return { seed: terrain.seed, terrain, entities, blocks, carrying: [] };
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
    const x = quantize((rng() * 2 - 1) * TERRAIN.island * 0.62);
    const z = quantize((rng() * 2 - 1) * TERRAIN.island * 0.62);
    const radius = Math.hypot(x, z);
    if (radius < minFromHome || radius > TERRAIN.island * 0.6) continue;
    const ground = terrain.height(x, z);
    const slope =
      Math.hypot(terrain.height(x + 0.8, z) - ground, terrain.height(x, z + 0.8) - ground) / 0.8;
    if (slope > 0.32) continue;
    const gap = kind === 'grass' ? 7 : MIN_GAP;
    if (placed.some((point) => Math.hypot(point.x - x, point.z - z) < gap)) continue;
    const footprint = kind === 'grass' ? { kind: 'circle' as const, r: 3.2 } : undefined;
    const probe = footprint?.kind === 'circle' ? footprint.r : 0.2;
    /* v8 ignore next */
    if (blockedAt(x, z, blocks, probe)) continue;
    placed.push({ x, z });
    entities.push({
      id: `${kind}-${entities.length + 1}`,
      kind,
      x,
      y: restingY(terrain, kind, x, z, footprint),
      z,
      stage: 0,
      footprint,
    });
  }
  return entities;
}
