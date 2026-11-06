// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { groundSupport } from '../../src/shared/contact.js';
import { blockedAt } from '../../src/shared/sight.js';
import { Terrain, TERRAIN } from '../../src/shared/terrain.js';
import {
  APPLE_EVERY,
  createWorld,
  grow,
  GRASS_VIEW,
  nestBlocks,
  settle,
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
  return (quantized(value) / (TERRAIN.island * 0.8) + 1) / 2;
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

  it('rests a round prop on the slope instead of hovering over it', () => {
    const height = terrain.height.bind(terrain);
    const apple = restingY(terrain, 'apple', 2, 1);
    expect(apple).toBeCloseTo(groundSupport(height, 2, 1, 0.36));
    expect(apple - terrain.height(2, 1)).toBeLessThan(0.05);
    expect(restingY(terrain, 'apple', 2, 1, { kind: 'circle', r: 0.9 })).toBeGreaterThanOrEqual(
      apple,
    );
    expect(
      restingY(terrain, 'apple', 2, 1, { kind: 'box', hx: 0.9, hz: 0.9 }),
    ).toBeGreaterThanOrEqual(apple);
  });

  it('uses a small default radius for unknown props', () => {
    const height = terrain.height.bind(terrain);
    expect(restingY(terrain, 'rock', 2, 1)).toBeCloseTo(groundSupport(height, 2, 1, 0.2));
  });
});

describe('nestBlocks', () => {
  it('builds a ring of walls with a door at -Z', () => {
    const blocks = nestBlocks();
    expect(blocks.length).toBeGreaterThan(12);
    expect(blocks.length).toBeLessThan(24);
    expect(blocks.every((wall) => wall.height === 1)).toBe(true);
    for (const wall of blocks) {
      const cx = (wall.minX + wall.maxX) / 2;
      const cz = (wall.minZ + wall.maxZ) / 2;
      expect(Math.hypot(cx, cz)).toBeCloseTo(2.62, 1);
      const away = Math.abs(
        Math.atan2(
          Math.sin(Math.atan2(cz, cx) + Math.PI / 2),
          Math.cos(Math.atan2(cz, cx) + Math.PI / 2),
        ),
      );
      expect(away).toBeGreaterThan(0.6);
      expect(wall.maxX).toBeGreaterThan(wall.minX);
      expect(wall.maxZ).toBeGreaterThan(wall.minZ);
    }
    expect(new Set(blocks.map((wall) => wall.id)).size).toBe(blocks.length);
  });

  it('leaves a body-wide door on -Z', () => {
    const blocks = nestBlocks();
    for (let z = -0.5; z >= -3.2; z -= 0.1) {
      expect(blockedAt(0, z, blocks)).toBe(false);
    }
    expect(blockedAt(2.62, 0, blocks)).toBe(true);
  });
});

describe('settle', () => {
  const flat = { height: () => 0 };

  it('leaves a fixed kind where it was put', () => {
    const slope = { height: (x: number) => x * 0.5 };
    expect(settle(slope, [], 'grass', { x: 5, z: 1 }, [])).toEqual({ x: 5, z: 1 });
  });

  it('keeps a loose body on a flat spot', () => {
    expect(settle(flat, [], 'apple', { x: 2, z: -1 }, [])).toEqual({ x: 2, z: -1 });
  });

  it('keeps a loose body that is still crossing a slope', () => {
    const slope = { height: (x: number) => x * 0.2 };
    const settled = settle(slope, [], 'apple', { x: 2, z: 1 }, [], { x: 30, z: 30 });
    expect(settled).not.toBeNull();
    expect(settled!.x).toBeLessThan(2);
  });

  it('rolls a loose body to a lower spot', () => {
    const slope = { height: (x: number) => Math.max(-0.5, x * 0.5) };
    const settled = settle(slope, [], 'apple', { x: 5, z: 0 }, [])!;
    expect(settled.x).toBeLessThan(5);
  });

  it('leaves a ridge crest for a lower neighbour', () => {
    const ridge = { height: (x: number, z: number) => Math.max(-0.5, -Math.hypot(x, z) * 0.5) };
    const settled = settle(ridge, [], 'apple', { x: 0, z: 0 }, [])!;
    expect(Math.hypot(settled.x, settled.z)).toBeGreaterThan(0);
  });

  it('refuses water, the spider, and crowded ground', () => {
    expect(settle({ height: () => -1 }, [], 'apple', { x: 0, z: 0 }, [])).toBeNull();
    expect(settle(flat, [], 'apple', { x: 0, z: 0 }, [], { x: 0.5, z: 0 })).toBeNull();
    expect(settle(flat, [], 'apple', { x: 0, z: 0 }, [{ x: 0.5, z: 0 }])).toBeNull();
  });

  it('stops when the roll hits a wall, a solid, or the island edge', () => {
    const downhill = { id: 'wall', minX: -2, maxX: 0.2, minZ: -1, maxZ: 1, height: 1 };
    expect(
      settle({ height: (x: number) => x * 0.5 }, [downhill], 'apple', { x: 3, z: 0 }, []),
    ).toBeNull();
    const buried = { id: 'wall', minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 1 };
    expect(settle(flat, [buried], 'apple', { x: 0, z: 0 }, [])).toBeNull();
    const rim = { height: (x: number) => (x < 35.2 ? (35.2 - x) * 0.5 : 0) };
    expect(settle(rim, [], 'apple', { x: 31, z: 0 }, [])).toBeNull();
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
      expect(Math.hypot(entity.x, entity.z)).toBeLessThanOrEqual(TERRAIN.island * 0.72);
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
    expect(apple).toBeTruthy();
    expect(Math.hypot(apple!.x - quantized(spot.x), apple!.z - quantized(spot.z))).toBeLessThan(6);

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
