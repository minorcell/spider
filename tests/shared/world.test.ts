import { afterEach, describe, expect, it, vi } from 'vitest';
import { Terrain, TERRAIN } from '../../src/shared/terrain.js';
import {
  APPLE_EVERY,
  createWorld,
  grow,
  GRASS_VIEW,
  nestBlocks,
  REACH,
  REACH_Y,
  restingY,
  VIEW_DISTANCE,
} from '../../src/shared/world.js';

/** Feed the scattered props a fixed random stream. */
const control = vi.hoisted(() => ({ enabled: false, queue: [] as number[] }));

vi.mock('../../src/shared/noise.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/noise.js')>();
  return {
    ...actual,
    mulberry32(seed: number) {
      if (!control.enabled) return actual.mulberry32(seed);
      return () => control.queue.shift() ?? 0.5;
    },
  };
});

const quantized = (value: number): number => Math.round(value * 10) / 10;

/** The scatter helper draws x and z from this same mapping. */
function toRng(value: number): number {
  return (quantized(value) / (TERRAIN.island * 0.62) + 1) / 2;
}

function findSlope(seed: number, minRadius: number): { x: number; z: number } | null {
  const terrain = new Terrain(seed);
  for (let ix = -210; ix <= 210; ix += 5) {
    for (let iz = -210; iz <= 210; iz += 5) {
      const x = ix / 10;
      const z = iz / 10;
      const radius = Math.hypot(x, z);
      if (radius < minRadius || radius > TERRAIN.island * 0.6) continue;
      const ground = terrain.height(x, z);
      const slope =
        Math.hypot(terrain.height(x + 0.8, z) - ground, terrain.height(x, z + 0.8) - ground) / 0.8;
      if (slope > 0.32) return { x, z };
    }
  }
  return null;
}

function findFlat(
  seed: number,
  minRadius: number,
  maxRadius = TERRAIN.island * 0.6,
): { x: number; z: number } | null {
  const terrain = new Terrain(seed);
  for (let ix = -210; ix <= 210; ix += 5) {
    for (let iz = -210; iz <= 210; iz += 5) {
      const x = ix / 10;
      const z = iz / 10;
      const radius = Math.hypot(x, z);
      if (radius < minRadius || radius > maxRadius) continue;
      const ground = terrain.height(x, z);
      const slope =
        Math.hypot(terrain.height(x + 0.8, z) - ground, terrain.height(x, z + 0.8) - ground) / 0.8;
      if (slope <= 0.32) return { x, z };
    }
  }
  return null;
}

function seedWith(
  finder: (seed: number, minRadius: number) => { x: number; z: number } | null,
  minRadius: number,
): number {
  for (let seed = 1; seed < 200; seed++) if (finder(seed, minRadius)) return seed;
  throw new Error('no seed found');
}

afterEach(() => {
  control.enabled = false;
  control.queue = [];
});

describe('constants', () => {
  it('exposes the sensing ranges', () => {
    expect(REACH).toBe(1.2);
    expect(VIEW_DISTANCE).toBe(16);
    expect(GRASS_VIEW).toBe(4.5);
    expect(REACH_Y).toBe(1.6);
  });
});

describe('restingY', () => {
  const terrain = { height: (x: number, z: number): number => 0.1 * x + 0.2 * z };

  it('sits grass and the nest on the center ground', () => {
    expect(restingY(terrain, 'grass', 2, 1)).toBeCloseTo(terrain.height(2, 1));
    expect(restingY(terrain, 'nest', 2, 1)).toBeCloseTo(terrain.height(2, 1));
  });

  it('lifts solid props to the highest ground under the footprint', () => {
    const center = terrain.height(2, 1) + 0.03;
    const apple = restingY(terrain, 'apple', 2, 1);
    expect(apple).toBeGreaterThan(center);
    expect(restingY(terrain, 'apple', 2, 1, { kind: 'circle', r: 0.9 })).toBeGreaterThan(apple);
    expect(restingY(terrain, 'apple', 2, 1, { kind: 'box', hx: 0.9, hz: 0.9 })).toBeGreaterThan(
      apple,
    );
  });

  it('uses a small default radius for unknown props', () => {
    expect(restingY(terrain, 'rock', 2, 1)).toBeGreaterThan(terrain.height(2, 1) + 0.03);
  });
});

describe('nestBlocks', () => {
  it('builds four walls and a gated south side', () => {
    const blocks = nestBlocks();
    expect(blocks.map((wall) => wall.id)).toEqual([
      'nest-w',
      'nest-e',
      'nest-n',
      'nest-s-w',
      'nest-s-e',
    ]);
    expect(blocks.every((wall) => wall.height === 0.72)).toBe(true);
    expect(blocks.at(-2)!.maxX).toBe(-1.25);
    expect(blocks.at(-1)!.minX).toBe(1.25);
  });
});

describe('createWorld', () => {
  it('builds the same island for a seed', () => {
    const a = createWorld(1234);
    const b = createWorld(1234);
    expect(a.entities).toEqual(b.entities);
    expect(a.blocks).toEqual(b.blocks);
    expect(a.seed).toBe(1234);
  });

  it('draws a random seed when none is given', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(createWorld().seed).toBe(500_000_000);
  });

  it('places the nest home at the origin', () => {
    const world = createWorld(99);
    expect(world.entities[0]).toMatchObject({ id: 'home', kind: 'nest', x: 0, z: 0 });
  });

  it('scatters grass and apples inside the island', () => {
    const world = createWorld(99);
    for (const entity of world.entities.slice(1)) {
      expect(Math.hypot(entity.x, entity.z)).toBeLessThanOrEqual(TERRAIN.island * 0.6);
      expect(entity.id.startsWith(`${entity.kind}-`)).toBe(true);
      expect(Number.isFinite(entity.y)).toBe(true);
    }
  });

  it('rejects points too close to home', () => {
    control.enabled = true;
    control.queue = [0.5, 0.5];
    const world = createWorld(7);
    expect(world.entities).toHaveLength(1);
  });

  it('rejects points past the outer ring', () => {
    control.enabled = true;
    control.queue = [0.99, 0.5, 0.01, 0.5];
    const world = createWorld(7);
    expect(world.entities).toHaveLength(1);
  });

  it('rejects ground that is too steep', () => {
    const seed = seedWith(findSlope, 6.5);
    const spot = findSlope(seed, 6.5)!;
    control.enabled = true;
    control.queue = [toRng(spot.x), toRng(spot.z)];
    const world = createWorld(seed);
    expect(world.entities.filter((entity) => entity.kind !== 'nest')).toEqual([]);
  });

  it('keeps scattered props apart', () => {
    const seed = seedWith(findFlat, 6.5);
    const spot = findFlat(seed, 6.5)!;
    control.enabled = true;
    control.queue = [toRng(spot.x), toRng(spot.z), toRng(spot.x), toRng(spot.z)];
    const grass = createWorld(seed).entities.filter((entity) => entity.kind === 'grass');
    expect(grass).toHaveLength(1);
  });

  it('gives grass a footprint', () => {
    const seed = seedWith(findFlat, 6.5);
    const spot = findFlat(seed, 6.5)!;
    control.enabled = true;
    control.queue = [toRng(spot.x), toRng(spot.z)];
    const grass = createWorld(seed).entities.find((entity) => entity.kind === 'grass');
    expect(grass?.footprint).toEqual({ kind: 'circle', r: 3.2 });
  });
});

function bare(seed = 11) {
  const world = createWorld(seed);
  world.entities = world.entities.filter((entity) => entity.kind !== 'apple');
  return world;
}

describe('grow', () => {
  it('leaves a hand-built world alone', () => {
    const world = createWorld(1);
    world.appleIn = undefined;
    grow(world, 100);
    world.appleIn = 0;
    world.sprouts = undefined;
    const before = world.entities.length;
    grow(world, 100);
    expect(world.entities).toHaveLength(before);
  });

  it('waits, then grows one apple, and stops at the original handful', () => {
    const world = bare();
    world.carrying = [{ id: 'apple-9', kind: 'apple', x: 0, y: 0, z: 0, stage: 0 }];
    grow(world, 10);
    expect(world.entities.some((entity) => entity.kind === 'apple')).toBe(false);
    expect(world.appleIn).toBeCloseTo(APPLE_EVERY - 10);

    grow(world, APPLE_EVERY - 10);
    const first = world.entities.filter((entity) => entity.kind === 'apple');
    expect(first.map((entity) => entity.id)).toEqual(['apple-10']);
    expect(first[0]?.stage).toBe(0);

    const again = bare();
    again.carrying = [{ id: 'apple-9', kind: 'apple', x: 0, y: 0, z: 0, stage: 0 }];
    grow(again, APPLE_EVERY);
    expect(again.entities.find((entity) => entity.kind === 'apple')).toEqual(first[0]);

    const full = createWorld(11);
    const count = full.entities.filter((entity) => entity.kind === 'apple').length;
    full.appleIn = 1;
    grow(full, 100);
    expect(full.appleIn).toBe(APPLE_EVERY);
    expect(full.entities.filter((entity) => entity.kind === 'apple')).toHaveLength(count);
  });

  it('does not grow into the spider, and gives up when nowhere is open', () => {
    const seed = seedWith(findFlat, 6);
    const spot = findFlat(seed, 6)!;
    const world = bare(seed);
    world.entities = world.entities.filter((entity) => entity.kind === 'nest');
    world.appleIn = 0;
    const rolls = Array.from({ length: 80 }, (_, index) =>
      index % 2 === 0 ? toRng(spot.x) : toRng(spot.z),
    );
    control.enabled = true;
    control.queue = [...rolls];
    grow(world, 0, spot);
    expect(world.entities.some((entity) => entity.kind === 'apple')).toBe(false);
    expect(world.sprouts).toBe(1);

    world.appleIn = 0;
    world.sprouts = 0;
    control.queue = [...rolls];
    grow(world, 0, { x: 0, z: 0 });
    const apple = world.entities.find((entity) => entity.kind === 'apple');
    expect(apple).toMatchObject({ x: quantized(spot.x), z: quantized(spot.z) });

    control.enabled = false;
    const stuck = bare(seed);
    stuck.appleIn = 0;
    control.enabled = true;
    control.queue = [];
    grow(stuck, 0);
    expect(stuck.entities.some((entity) => entity.kind === 'apple')).toBe(false);
    expect(stuck.sprouts).toBe(1);
    expect(stuck.appleIn).toBe(APPLE_EVERY);
  });
});
