import { describe, expect, it } from 'vitest';
import { planRoute } from '../../src/shared/route.js';
import { block, flat } from '../helpers.js';

const LIMIT = 20;

describe('planRoute', () => {
  it('walks straight when the line is clear', () => {
    const plan = planRoute(0, 0, 5, 0, [], flat, LIMIT);
    expect(plan).toEqual({
      points: [
        { x: 0, z: 0 },
        { x: 5, z: 0 },
      ],
      around: [],
      direct: true,
    });
  });

  it('refuses a goal outside the limit', () => {
    expect(planRoute(0, 0, 25, 0, [], flat, LIMIT)).toBeNull();
    expect(planRoute(0, 0, 0, -25, [], flat, LIMIT)).toBeNull();
  });

  it('refuses a goal inside a solid', () => {
    const wall = block('wall', 2, 4, -1, 1);
    expect(planRoute(0, 0, 3, 0, [wall], flat, LIMIT)).toBeNull();
  });

  it('refuses a start inside a solid or outside the limit', () => {
    const wall = block('wall', -1, 1, -1, 1);
    expect(planRoute(0, 0, 5, 0, [wall], flat, LIMIT)).toBeNull();
    expect(planRoute(-25, 0, 5, 0, [], flat, LIMIT)).toBeNull();
  });

  it('routes around one solid and reports it', () => {
    const wall = block('wall', 2, 4, -1, 1);
    const plan = planRoute(0, 0, 6, 0, [wall], flat, LIMIT);
    expect(plan).not.toBeNull();
    expect(plan?.direct).toBe(false);
    expect(plan?.around).toEqual(['wall']);
    expect(plan!.points.length).toBeGreaterThan(2);
    expect(plan!.points[0]).toEqual({ x: 0, z: 0 });
    expect(plan!.points.at(-1)).toEqual({ x: 6, z: 0 });
  });

  it('routes through a maze of solids', () => {
    const blocks = [
      block('a', 2, 4, -3, 1),
      block('b', 2, 4, 3, 6),
      block('c', 6, 8, -1, 4),
      block('d', 2, 4, 1, 2),
    ];
    const plan = planRoute(0, 0, 9, 5, blocks, flat, LIMIT);
    expect(plan).not.toBeNull();
    expect(plan?.direct).toBe(false);
    expect(plan!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates coincident corners', () => {
    const blocks = [block('a', 2, 4, -1, 1), block('b', 2, 4, -1, 1)];
    const plan = planRoute(0, 0, 6, 0, blocks, flat, LIMIT);
    expect(plan).not.toBeNull();
    expect(plan?.around).toEqual(['a']);
  });

  it('skips corners outside the limit', () => {
    const blocks = [block('edge', 19.7, 19.8, -1, 1), block('wall', 2, 4, -1, 1)];
    const plan = planRoute(0, 0, 6, 0, blocks, flat, LIMIT);
    expect(plan).not.toBeNull();
  });

  it('gives up when every way is walled off', () => {
    const blocks = [
      block('n', -3, 3, 1, 2),
      block('s', -3, 3, -2, -1),
      block('w', -3, -2, -2, 2),
      block('e', 2, 3, -2, 2),
    ];
    expect(planRoute(8, 0, 0, 0, blocks, flat, LIMIT)).toBeNull();
  });

  it('treats a too-steep rise as blocked', () => {
    const steep = (x: number): number => (x > 0 ? 10 : 0);
    expect(planRoute(-1, 0, 1, 0, [], steep, LIMIT)).toBeNull();
  });

  it('rejects waypoints past the edge of the ground', () => {
    const plan = planRoute(0, 0, 5, 0, [], flat, 2.5);
    expect(plan).toBeNull();
  });
});
