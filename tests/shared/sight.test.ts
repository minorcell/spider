import { describe, expect, it } from 'vitest';
import {
  blockAt,
  blockedAt,
  BODY_RADIUS,
  grassHere,
  HOME,
  insideHome,
  occluded,
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
