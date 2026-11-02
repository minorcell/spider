// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { bakeTerrainGrid, surfaceAt, Terrain, TERRAIN } from '../../src/shared/terrain.js';

describe('Terrain', () => {
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
