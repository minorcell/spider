import { describe, expect, it } from 'vitest';
import {
  blockAt,
  blockedAt,
  BODY_RADIUS,
  coverAt,
  groundOccluded,
  homeAt,
  occluded,
} from '@/src/shared/sight';
import type { EntityState } from '@/src/shared/state';
import { block } from '@/tests/helpers';

describe('homeAt', () => {
  it('uses a registered home boundary at the entity position', () => {
    const home: EntityState = { id: 'home', kind: 'nest', x: 5, y: 0, z: -3, stage: 0 };
    expect(homeAt(5, -3, [home])).toBe(home);
    expect(homeAt(5 + 2.15, -3 - 2.15, [home])).toBe(home);
    expect(homeAt(5 + 2.16, -3, [home])).toBeNull();
    expect(homeAt(5, -3 - 2.16, [home])).toBeNull();
    expect(homeAt(0, 0, [])).toBeNull();
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

describe('coverAt', () => {
  const at = (kind: string, footprint?: EntityState['footprint']): EntityState => ({
    id: kind,
    kind,
    x: 0,
    y: 0,
    z: 0,
    stage: 0,
    footprint,
  });

  it('is true inside a grass circle while the eyes are below the blades', () => {
    expect(coverAt(1, 0, [at('grass', { kind: 'circle', r: 2 })])).toBeTruthy();
    expect(coverAt(1, 0, [at('grass', { kind: 'circle', r: 2 })], 0.5)).toBeTruthy();
  });

  it('is false once the eyes are above the grass', () => {
    expect(coverAt(1, 0, [at('grass', { kind: 'circle', r: 2 })], 2)).toBeNull();
  });

  it('is false outside it, or for other kinds', () => {
    expect(coverAt(3, 0, [at('grass', { kind: 'circle', r: 2 })])).toBeNull();
    expect(coverAt(0, 0, [at('apple', { kind: 'circle', r: 2 })])).toBeNull();
  });

  it('ignores grass without a circle footprint', () => {
    expect(coverAt(0, 0, [at('grass')])).toBeNull();
    expect(coverAt(0, 0, [at('grass', { kind: 'box', hx: 1, hz: 1 })])).toBeNull();
  });
});
