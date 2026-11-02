// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { surfaceAt, Terrain, TERRAIN } from '../../src/shared/terrain.js';

describe('Terrain', () => {
  it('keeps the unsigned seed', () => {
    expect(new Terrain(9).seed).toBe(9);
    expect(new Terrain(-1).seed).toBe(4294967295);
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

  it('is flat past the island rim', () => {
    const terrain = new Terrain(5);
    expect(terrain.height(30, 0)).toBe(0);
    expect(terrain.height(100, 100)).toBe(0);
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
