import { describe, expect, it } from 'vitest';
import { blockAt, moveCircle, sweepCircle } from '@/src/shared/collision';
import { block } from '@/tests/helpers';

const box = block('box', -1, 1, -1, 1);

describe('continuous spatial queries', () => {
  it.each([
    [-5, 0, 10, 0, -1, 0],
    [5, 0, -10, 0, 1, 0],
    [0, -5, 0, 10, 0, -1],
    [0, 5, 0, -10, 0, 1],
  ])('sweeps into a face from (%s, %s)', (x, z, dx, dz, nx, nz) => {
    const hit = sweepCircle(x, z, dx, dz, 0.25, [box]);
    expect(hit).toMatchObject({ time: 0.375, nx, nz, block: box });
  });

  it.each([
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ])('uses the rounded corner in quadrant (%s, %s)', (sx, sz) => {
    const hit = sweepCircle(sx * 5, sz * 5, -sx * 10, -sz * 10, 0.5, [box])!;
    expect(hit.time).toBeCloseTo((4 - 0.5 / Math.SQRT2) / 10);
    expect(hit.nx).toBeCloseTo(sx / Math.SQRT2);
    expect(hit.nz).toBeCloseTo(sz / Math.SQRT2);
  });

  it('does not collide with empty space beside a rounded corner or a tangent', () => {
    expect(sweepCircle(-1.4, -2, 0, 0.7, 0.49, [box])).toBeNull();
    expect(sweepCircle(-1.5, -2, 0, 4, 0.5, [box])).toBeNull();
    expect(sweepCircle(-5, 5, 1, 0, 0.5, [box])).toBeNull();
    expect(sweepCircle(0, 0, 0, 0, 0.5, [box])).toBeNull();
  });

  it('returns the first contact independent of registration order', () => {
    const far = block('far', 3, 4, -1, 1);
    for (const boxes of [
      [box, far],
      [far, box],
    ]) {
      expect(sweepCircle(-5, 0, 15, 0, 0.1, boxes)?.block.id).toBe('box');
    }
  });

  it('prevents deeper initial overlap while allowing escape', () => {
    expect(sweepCircle(-1.1, 0, 1, 0, 0.2, [box])?.time).toBe(0);
    expect(sweepCircle(-1.1, 0, -1, 0, 0.2, [box])).toBeNull();
    expect(sweepCircle(0, 0, 1, 0, 0.2, [box])?.time).toBe(0);
    expect(sweepCircle(0, 0, -3, 0, 0.2, [box])).toBeNull();
    expect(sweepCircle(-1, 0, 3, 0, 0.2, [box])?.time).toBe(0);
    expect(sweepCircle(0.8, 0, -1, 0, 0.2, [box])?.time).toBe(0);
    expect(sweepCircle(0, 0.8, 0, -1, 0.2, [box])?.time).toBe(0);
    expect(sweepCircle(0, -0.8, 0, 1, 0.2, [box])?.time).toBe(0);
  });

  it('supports point bodies and treats only the interior as occupied', () => {
    expect(blockAt(0, 0, [box], 0)).toBe(box);
    expect(blockAt(1, 0, [box], 0)).toBeNull();
    expect(blockAt(0, 1, [box], 0)).toBeNull();
    expect(sweepCircle(-5, 0, 10, 0, 0, [box])?.time).toBe(0.4);
  });
});

describe('shared movement response', () => {
  it('stops a tiny fast body at a thin wall even when both endpoints are clear', () => {
    const wall = block('thin', 0.03, 0.031, -5, 5);
    const moved = moveCircle(-1, 0, 3, 0, 0.01, { blocks: [wall] });
    expect(moved.x).toBeCloseTo(0.02, 6);
    expect(moved.x).toBeLessThanOrEqual(0.02);
    expect(moved.dx).toBe(0);
    expect(moved.halt).toBe('solid');
  });

  it('retains tangential movement and velocity against a wall', () => {
    const wall = block('wall', 0, 1, -10, 10);
    const moved = moveCircle(-1, 0, 3, 2, 0.25, { blocks: [wall] });
    expect(moved.x).toBeCloseTo(-0.25, 6);
    expect(moved.z).toBeCloseTo(2, 6);
    expect(moved.dx).toBe(0);
    expect(moved.dz).toBe(2);
  });

  it('stops against a second wall after sliding along the first', () => {
    const walls = [block('right', 0, 1, -10, 10), block('top', -10, 10, 1, 2)];
    const moved = moveCircle(-1, 0, 3, 3, 0.25, { blocks: walls });
    expect(moved.x).toBeCloseTo(-0.25, 6);
    expect(moved.z).toBeCloseTo(0.75, 6);
    expect(Math.hypot(moved.dx, moved.dz)).toBeCloseTo(0);
    expect(blockAt(moved.x, moved.z, walls, 0.25)).toBeNull();
  });

  it('checks the whole coast path and clips movement to its last valid position', () => {
    const moved = moveCircle(-1, 0, 2, 0, 0.1, { blocks: [], inside: (x) => Math.abs(x) >= 0.2 });
    expect(moved.x).toBeCloseTo(-0.2, 6);
    expect(moved.x).toBeLessThanOrEqual(-0.2);
    expect(moved).toMatchObject({ dx: 0, dz: 0, halt: 'solid' });
  });

  it('stops before a steep surface even if the final height is low', () => {
    const moved = moveCircle(-1, 0, 2, 0, 0.1, {
      blocks: [],
      surface: (x) => (Math.abs(x) < 0.3 ? 5 : 0),
      maxSlope: 1,
    });
    expect(moved.x).toBeLessThan(-0.3);
    expect(moved).toMatchObject({ dx: 0, dz: 0, halt: 'steep' });
  });

  it('chooses the earlier of a wall and a terrain limit', () => {
    const wall = block('wall', 0, 1, -5, 5);
    const firstWall = moveCircle(-2, 0, 5, 0, 0.2, { blocks: [wall], inside: (x) => x < 2 });
    expect(firstWall.x).toBeCloseTo(-0.2, 6);
    const firstEdge = moveCircle(-2, 0, 5, 0, 0.2, { blocks: [wall], inside: (x) => x < -1 });
    expect(firstEdge.x).toBeCloseTo(-1, 6);
  });

  it('allows an unconstrained surface and a zero movement', () => {
    expect(moveCircle(0, 0, 1, 2, 0.2, { blocks: [], surface: (x) => x * 3 })).toMatchObject({
      x: 1,
      z: 2,
      dx: 1,
      dz: 2,
      halt: 'clear',
    });
    expect(moveCircle(0, 0, 0, 0, 0.2, { blocks: [box] })).toMatchObject({
      x: 0,
      z: 0,
      dx: 0,
      dz: 0,
      halt: 'clear',
    });
  });
});
