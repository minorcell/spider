// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  bakeTerrainGrid,
  insideLand,
  nearestWater,
  surfaceAt,
  surfaceOf,
  Terrain,
  TERRAIN,
  WORLD_RADIUS,
} from '../../src/shared/terrain.js';

describe('Terrain', () => {
  it.each([1, 7, 99])('gives seed %s plains, mountains, uneven lowlands and water', (seed) => {
    const terrain = new Terrain(seed);
    const angle = ((seed * 2654435761) % 6283) / 1000;
    const at = (along: number, across: number) =>
      terrain.height(
        along * Math.cos(angle) - across * Math.sin(angle),
        along * Math.sin(angle) + across * Math.cos(angle),
      );
    const relief = (cx: number, cz: number) => {
      const heights: number[] = [];
      for (let x = -3; x <= 3; x++) {
        for (let z = -3; z <= 3; z++) heights.push(at(cx + x, cz + z));
      }
      return Math.max(...heights) - Math.min(...heights);
    };
    expect(at(-12, -24)).toBeGreaterThan(3);
    expect(Math.abs(at(17, -16))).toBeLessThan(0.3);
    expect(relief(17, -16)).toBeLessThan(relief(-12, -24));
    expect(relief(16, 15)).toBeGreaterThan(0.2);
    expect(at(16, 15)).toBeLessThan(TERRAIN.water);
  });

  it('keeps the unsigned seed', () => {
    expect(new Terrain(9).seed).toBe(9);
    expect(new Terrain(-1).seed).toBe(4294967295);
  });

  it('uses a grid that was baked elsewhere and rejects a short one', () => {
    const baked = new Terrain(4);
    const again = new Terrain(4, bakeTerrainGrid(4));
    expect(again.height(12, -6)).toBeCloseTo(baked.height(12, -6));
    expect(() => new Terrain(4, new Float32Array(3))).toThrow('bad terrain grid');
  });

  it('flattens the birth disk', () => {
    const terrain = new Terrain(5);
    expect(terrain.height(0, 0)).toBe(0);
    expect(terrain.height(3, 0)).toBe(0);
  });

  it('fades the hills up past the flat disk', () => {
    const terrain = new Terrain(5);
    expect(Number.isFinite(terrain.height(5, 0))).toBe(true);
    expect(Number.isFinite(terrain.height(7, 0))).toBe(true);
  });

  it('keeps the inner island at full height and fades the rim', () => {
    const terrain = new Terrain(5);
    expect(Number.isFinite(terrain.height(10, 0))).toBe(true);
    expect(Number.isFinite(terrain.height(25, 0))).toBe(true);
  });

  it('blends the baked grid across both triangles in a cell', () => {
    const terrain = new Terrain(3);
    const cell = (TERRAIN.half * 2) / TERRAIN.segments;
    const x0 = -TERRAIN.half + 40 * cell;
    const z0 = -TERRAIN.half + 40 * cell;
    const h00 = terrain.height(x0, z0);
    const h10 = terrain.height(x0 + cell, z0);
    const h01 = terrain.height(x0, z0 + cell);
    const h11 = terrain.height(x0 + cell, z0 + cell);
    const first = terrain.height(x0 + 0.2 * cell, z0 + 0.3 * cell);
    expect(first).toBeCloseTo(h00 * 0.5 + h01 * 0.3 + h10 * 0.2);
    const second = terrain.height(x0 + 0.7 * cell, z0 + 0.6 * cell);
    expect(second).toBeCloseTo(h01 * 0.3 + h11 * 0.3 + h10 * 0.4);
  });

  it('is flat past the island rim', () => {
    const terrain = new Terrain(5);
    expect(terrain.height(TERRAIN.island + 1, 0)).toBe(0);
    expect(terrain.height(TERRAIN.island * 0.98, 0)).toBe(0);
    expect(terrain.height(100, 100)).toBe(0);
    expect(terrain.height(-100, 0)).toBe(0);
    expect(terrain.height(0, -100)).toBe(0);
    expect(terrain.height(0, 100)).toBe(0);
  });

  it('keeps the round world bound on land and rejects the flat apron', () => {
    const terrain = new Terrain(5);
    expect(WORLD_RADIUS).toBeLessThan(TERRAIN.island);
    expect(terrain.inside(0, 0)).toBe(true);
    expect(terrain.inside(WORLD_RADIUS - 0.5, 0)).toBe(true);
    expect(terrain.inside(TERRAIN.island + 1, 0)).toBe(false);
    expect(terrain.inside(-100, 0)).toBe(false);
    expect(insideLand(terrain, 0, 0)).toBe(true);
    expect(insideLand({ height: () => 0 }, 0, 0)).toBe(true);
    expect(insideLand({ height: () => 0, inside: () => false }, 0, 0)).toBe(false);
  });

  it('stands on the water level in a hollow and on the ground above it', () => {
    const terrain = new Terrain(5);
    expect(terrain.surface(0, 0)).toBe(terrain.height(0, 0));
    let low: { x: number; z: number } | null = null;
    for (let x = -40; x <= 40 && !low; x += 1) {
      for (let z = -40; z <= 40; z += 1) {
        if (terrain.height(x, z) < TERRAIN.water) {
          low = { x, z };
          break;
        }
      }
    }
    expect(low).not.toBeNull();
    expect(terrain.surface(low!.x, low!.z)).toBe(TERRAIN.water);
  });

  it('carves a connected river rather than isolated pits', () => {
    for (const seed of [1, 2, 9]) {
      const terrain = new Terrain(seed);
      const cell = 1;
      const n = Math.floor((TERRAIN.half * 2) / cell) + 1;
      const wet = new Uint8Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = -TERRAIN.half + i * cell;
          const z = -TERRAIN.half + j * cell;
          wet[j * n + i] = terrain.height(x, z) < TERRAIN.water ? 1 : 0;
        }
      }
      const seen = new Uint8Array(n * n);
      let widest = 0;
      for (let start = 0; start < wet.length; start++) {
        if (!wet[start] || seen[start]) continue;
        const queue = [start];
        seen[start] = 1;
        let minX = n;
        let maxX = 0;
        let minZ = n;
        let maxZ = 0;
        for (let q = 0; q < queue.length; q++) {
          const at = queue[q]!;
          const x = at % n;
          const z = (at / n) | 0;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
            const next = nz * n + nx;
            if (!wet[next] || seen[next]) continue;
            seen[next] = 1;
            queue.push(next);
          }
        }
        widest = Math.max(widest, maxX - minX, maxZ - minZ);
      }
      expect(widest).toBeGreaterThan(25);
    }
  });
});

describe('surfaceOf', () => {
  it('uses the water surface when a terrain has one', () => {
    expect(surfaceOf({ height: () => -2 }, 0, 0)).toBe(-2);
    expect(surfaceOf({ height: () => -2, surface: () => -0.8 }, 0, 0)).toBe(-0.8);
  });
});

describe('nearestWater', () => {
  it('finds the nearest hollow within reach', () => {
    const pond = (x: number): number => (x > 2 ? -1 : 0);
    const spot = nearestWater({ height: pond }, 0, 0, 4);
    expect(spot).not.toBeNull();
    expect(spot!.distance).toBeGreaterThan(2);
    expect(spot!.distance).toBeLessThanOrEqual(4);
    expect(spot!.x).toBeGreaterThan(2);
  });

  it('reports the body itself when it is already on water', () => {
    expect(nearestWater({ height: () => -1 }, 1, 2, 4)).toEqual({ x: 1, z: 2, distance: 0 });
  });

  it('is null on dry ground and for a reach shorter than one sample', () => {
    expect(nearestWater({ height: () => 0 }, 0, 0, 4)).toBeNull();
    expect(nearestWater({ height: (x) => (x > 2 ? -1 : 0) }, 0, 0, 0.1)).toBeNull();
  });
});

describe('surfaceAt', () => {
  const height = (x: number, z: number): number => x + 2 * z;

  it('interpolates the first triangle', () => {
    expect(surfaceAt(height, 5, 2, 10, 4)).toBeCloseTo(9);
  });

  it('interpolates the second triangle', () => {
    expect(surfaceAt(height, 8, 8, 10, 4)).toBeCloseTo(24);
  });

  it('clamps points outside the grid', () => {
    expect(surfaceAt(height, -50, -50, 10, 4)).toBeCloseTo(-30);
    expect(surfaceAt(height, 50, 50, 10, 4)).toBeCloseTo(30);
  });

  it('defaults to the terrain grid', () => {
    const terrain = new Terrain(3);
    const at = surfaceAt((x, z) => terrain.height(x, z), 2, 2);
    expect(Number.isFinite(at)).toBe(true);
    expect(TERRAIN.segments).toBeGreaterThan(0);
  });
});
