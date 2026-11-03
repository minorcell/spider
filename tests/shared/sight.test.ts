// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  blockAt,
  blockedAt,
  BODY_RADIUS,
  grassHere,
  groundOccluded,
  HOME,
  insideHome,
  occluded,
  sightOutline,
} from '../../src/shared/sight.js';
import type { EntityState } from '../../src/shared/state.js';
import { block } from '../helpers.js';

describe('insideHome', () => {
  it('includes the boundary', () => {
    expect(insideHome(0, 0)).toBe(true);
    expect(insideHome(HOME.half, -HOME.half)).toBe(true);
    expect(insideHome(HOME.half + 0.01, 0)).toBe(false);
    expect(insideHome(0, -HOME.half - 0.01)).toBe(false);
  });
});

describe('blockAt', () => {
  const wall = block('wall', -1, 1, -1, 1);

  it('returns null when nothing overlaps', () => {
    expect(blockAt(5, 5, [wall])).toBeNull();
    expect(blockAt(5, 5, [])).toBeNull();
  });

  it('finds the overlapping solid', () => {
    expect(blockAt(0, 0, [wall])).toBe(wall);
    expect(blockedAt(0, 0, [wall])).toBe(true);
    expect(blockedAt(5, 5, [wall])).toBe(false);
  });

  it('uses a custom radius', () => {
    const x = 1 + BODY_RADIUS + 0.01;
    expect(blockAt(x, 0, [wall])).toBeNull();
    expect(blockAt(x, 0, [wall], BODY_RADIUS + 0.05)).toBe(wall);
  });

  it('treats the exact radius as clear', () => {
    expect(blockAt(1 + BODY_RADIUS, 0, [wall])).toBeNull();
  });

  it('picks the nearest of overlapping solids', () => {
    const near = block('near', -1, 1, -1, 1);
    const nearer = block('nearer', 1.2, 2, -1, 1);
    expect(blockAt(1.1, 0, [near, nearer])).toBe(nearer);
    expect(blockAt(0.9, 0, [near, nearer])).toBe(near);
  });
});

describe('occluded', () => {
  const front = block('front', -1, 1, -1, 1, 2);

  it('reports a solid across the line', () => {
    expect(occluded(-5, 0, 5, 0, [front], 'other', 1)).toBe(true);
  });

  it('ignores the target itself', () => {
    expect(occluded(-5, 0, 5, 0, [front], 'front', 1)).toBe(false);
  });

  it('looks over a solid shorter than the eye', () => {
    expect(occluded(-5, 0, 5, 0, [front], 'other', 3)).toBe(false);
  });

  it('rejects a segment that runs beside the solid', () => {
    expect(occluded(0, 5, 0, 6, [front], 'other', 1)).toBe(false);
    expect(occluded(-5, 5, 5, 5, [front], 'other', 1)).toBe(false);
  });

  it('rejects a segment that misses the slab', () => {
    const far = block('far', 10, 12, -1, 1, 2);
    expect(occluded(-5, 0, 5, 0, [far], 'other', 1)).toBe(false);
  });

  it('ignores a touch only at the far end', () => {
    expect(occluded(-5, 0, -1.01, 0, [front], 'other', 1)).toBe(false);
    expect(occluded(-5, 0, -0.99, 0, [front], 'other', 1)).toBe(false);
  });
});

describe('groundOccluded', () => {
  it('sees over flat ground and along a slope', () => {
    expect(groundOccluded(0, 0, 1, 10, 1, 0, () => 0)).toBe(false);
    expect(groundOccluded(0, 0, 1, 10, 3, 0, (x) => x * 0.2)).toBe(false);
  });

  it('is hidden behind a ridge between the two points', () => {
    const ridge = (x: number): number => (x > 4 && x < 6 ? 3 : 0);
    expect(groundOccluded(0, 0, 1, 10, 1, 0, ridge)).toBe(true);
  });

  it('sees over a low bump that is not a ridge', () => {
    const bump = (x: number): number => (x > 4 && x < 6 ? 1.1 : 0);
    expect(groundOccluded(0, 0, 1, 10, 1, 0, bump)).toBe(false);
  });

  it('handles a very short span without sampling the same point', () => {
    expect(groundOccluded(0, 0, 1, 0, 1, 0, () => 100)).toBe(false);
  });
});

describe('sightOutline', () => {
  it('keeps a full circle on flat ground', () => {
    const points = sightOutline(0, 0, 0.85, 8, () => 0, [], 8);
    expect(points).toHaveLength(8);
    for (const point of points) expect(Math.hypot(point.x, point.z)).toBeCloseTo(8);
  });

  it('stops in front of a bank and stays full on the open side', () => {
    const bank = (_x: number, z: number): number => (z < -4 ? 3 : 0);
    const points = sightOutline(0, 0, 0.85, 8, bank, [], 16);
    expect(points[0].z).toBeLessThan(-3.5);
    expect(points[0].z).toBeGreaterThan(-4.75);
    expect(points[8].z).toBeCloseTo(8);
  });

  it('does not see down the far side of a bank', () => {
    // A long plateau: every point behind the crest is lower than the crest.
    const bank = (_x: number, z: number): number => (z < -4 ? 3 : 0);
    const points = sightOutline(0, 0, 0.85, 16, bank, [], 16);
    expect(points[0].z).toBeGreaterThan(-4.75);
  });

  it('stops behind a wall', () => {
    const screen = block('screen', -1, 1, -4, -2);
    const points = sightOutline(0, 0, 0.85, 8, () => 0, [screen], 16);
    expect(points[0].z).toBeGreaterThan(-2.5);
    expect(points[8].z).toBeCloseTo(8);
  });

  it('looks over a wall shorter than the eye', () => {
    const low = block('low', -1, 1, -4, -2, 0.5);
    const points = sightOutline(0, 0, 0.85, 8, () => 0, [low], 16);
    expect(points[0].z).toBeCloseTo(-8);
  });

  it('is a single point when the look does not reach', () => {
    expect(sightOutline(1, 2, 0.85, 0, () => 0, [], 8)).toEqual(
      Array.from({ length: 8 }, () => ({ x: 1, z: 2 })),
    );
  });
});

describe('grassHere', () => {
  const at = (kind: string, footprint?: EntityState['footprint']): EntityState => ({
    id: kind,
    kind,
    x: 0,
    y: 0,
    z: 0,
    stage: 0,
    footprint,
  });

  it('is true inside a grass circle', () => {
    expect(grassHere(1, 0, [at('grass', { kind: 'circle', r: 2 })])).toBe(true);
  });

  it('is false outside it, or for other kinds', () => {
    expect(grassHere(3, 0, [at('grass', { kind: 'circle', r: 2 })])).toBe(false);
    expect(grassHere(0, 0, [at('apple', { kind: 'circle', r: 2 })])).toBe(false);
  });

  it('ignores grass without a circle footprint', () => {
    expect(grassHere(0, 0, [at('grass')])).toBe(false);
    expect(grassHere(0, 0, [at('grass', { kind: 'box', hx: 1, hz: 1 })])).toBe(false);
  });
});
