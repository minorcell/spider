import { describe, expect, it } from 'vitest';
import type { Spider } from '../../../src/shared/sim/Spider.js';
import {
  heightGoal,
  routeGoal,
  STUCK_LIMIT,
  turnGoal,
  walkGoal,
} from '../../../src/shared/sim/goals.js';

interface Fake {
  root: { position: { x: number; z: number } };
  yaw: number;
  speed: number;
  yawRate: number;
  heightSet: number;
  stuckFor: number;
  halt: 'clear' | 'solid' | 'steep';
}

function fake(over: Partial<Fake> = {}): Spider {
  return {
    root: { position: { x: 0, z: 0 } },
    yaw: 0,
    speed: 0,
    yawRate: 0,
    heightSet: 0,
    stuckFor: 0,
    halt: 'clear',
    ...over,
  } as unknown as Spider;
}

describe('walkGoal', () => {
  it('drives forward with full throttle', () => {
    const spider = fake();
    const goal = walkGoal(spider, 10);
    expect(goal.timeout).toBeCloseTo(10 / 1.2 + 3);
    expect(goal.controls()).toEqual({ throttle: 1, turn: 0, lift: 0, boost: 0 });
    expect(goal.done()).toBe(false);
  });

  it('runs faster when asked', () => {
    const spider = fake();
    const goal = walkGoal(spider, 10, true);
    expect(goal.timeout).toBeCloseTo(10 / 2.4 + 3);
    expect(goal.controls().boost).toBe(1);
  });

  it('applies a negative throttle when backing up', () => {
    const spider = fake();
    const goal = walkGoal(spider, -2);
    expect(goal.controls().throttle).toBe(-1);
  });

  it('treats a zero distance as forward', () => {
    const spider = fake();
    expect(walkGoal(spider, 0).controls().throttle).toBe(0);
  });

  it('finishes within the tolerance and reports the distance covered', () => {
    const spider = fake();
    const goal = walkGoal(spider, 10);
    spider.root.position.z = -10;
    expect(goal.done()).toBe(true);
    const result = goal.result();
    expect(result.target).toBe(10);
    expect(result.achieved).toBeCloseTo(10);
  });

  it('does not finish while still fast', () => {
    const spider = fake({ speed: 1 });
    const goal = walkGoal(spider, 10);
    spider.root.position.z = -10;
    expect(goal.done()).toBe(false);
  });

  it('gives up and reports the halt when stuck', () => {
    const spider = fake({ stuckFor: STUCK_LIMIT, halt: 'solid' });
    const goal = walkGoal(spider, 10);
    expect(goal.done()).toBe(true);
    const result = goal.result();
    expect(result.target).toBe(10);
    expect(result.achieved).toBeCloseTo(0);
    expect(result.halt).toBe('solid');
  });

  it('backs up and reports the signed distance', () => {
    const spider = fake();
    const goal = walkGoal(spider, -10);
    spider.root.position.z = 10;
    const result = goal.result();
    expect(result.target).toBe(-10);
    expect(result.achieved).toBeCloseTo(-10);
  });
});

describe('turnGoal', () => {
  it('turns clockwise hard', () => {
    const spider = fake();
    const goal = turnGoal(spider, 90);
    expect(goal.controls()).toEqual({ throttle: 0, turn: 1, lift: 0, boost: 0 });
    expect(goal.done()).toBe(false);
  });

  it('turns counter-clockwise hard', () => {
    const spider = fake();
    expect(turnGoal(spider, -90).controls().turn).toBe(-1);
  });

  it('wraps a half turn without landing on -180', () => {
    const spider = fake();
    expect(turnGoal(spider, 180).controls().turn).toBe(-1);
  });

  it('finishes on target with no yaw rate', () => {
    const spider = fake();
    const goal = turnGoal(spider, 90);
    spider.yaw = -Math.PI / 2;
    expect(goal.done()).toBe(true);
    expect(goal.result()).toEqual({ target: 90, achieved: 90 });
  });

  it('does not finish while still turning', () => {
    const spider = fake();
    const goal = turnGoal(spider, 90);
    spider.yaw = -Math.PI / 2;
    spider.yawRate = 0.5;
    expect(goal.done()).toBe(false);
  });
});

describe('routeGoal', () => {
  it('stops on a single point', () => {
    const spider = fake();
    const goal = routeGoal(spider, [{ x: 0, z: 0 }]);
    expect(goal.timeout).toBe(8);
    expect(goal.controls()).toEqual({ throttle: 0, turn: 0, lift: 0, boost: 0 });
    expect(goal.done()).toBe(true);
    expect(goal.result()).toEqual({});
  });

  it('drives toward the next waypoint', () => {
    const spider = fake({ root: { position: { x: 0, z: -5 } } });
    const goal = routeGoal(spider, [
      { x: 0, z: 0 },
      { x: 0, z: -10 },
    ]);
    expect(goal.timeout).toBe(14);
    expect(goal.controls().throttle).toBe(1);
    expect(Math.abs(goal.controls().turn)).toBeLessThan(1e-9);
    expect(goal.done()).toBe(false);
  });

  it('runs the route when asked', () => {
    const spider = fake({ root: { position: { x: 0, z: -5 } } });
    const goal = routeGoal(
      spider,
      [
        { x: 0, z: 0 },
        { x: 0, z: -10 },
      ],
      true,
    );
    expect(goal.timeout).toBeCloseTo(10 / 2.2 + 4);
    expect(goal.controls().boost).toBe(1);
  });

  it('turns toward a waypoint off the heading', () => {
    const spider = fake();
    const goal = routeGoal(spider, [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
    ]);
    expect(goal.controls().turn).toBeGreaterThan(0);
    expect(goal.controls().throttle).toBe(0);
  });

  it('drives toward an intermediate waypoint', () => {
    const spider = fake({ root: { position: { x: 0, z: -1 } } });
    const goal = routeGoal(spider, [
      { x: 0, z: 0 },
      { x: 0, z: -5 },
      { x: 0, z: -10 },
    ]);
    expect(goal.controls().throttle).toBe(1);
    expect(goal.done()).toBe(false);
  });

  it('advances past a reached intermediate waypoint', () => {
    const spider = fake({ root: { position: { x: 0, z: -4.9 } } });
    const goal = routeGoal(spider, [
      { x: 0, z: 0 },
      { x: 0, z: -5 },
      { x: 0, z: -10 },
    ]);
    expect(goal.done()).toBe(false);
    expect(goal.controls().throttle).toBe(1);
  });

  it('finishes on the last point when slow', () => {
    const spider = fake({ root: { position: { x: 0, z: -9.9 } } });
    const goal = routeGoal(spider, [
      { x: 0, z: 0 },
      { x: 0, z: -10 },
    ]);
    expect(goal.done()).toBe(true);
  });

  it('treats duplicate points as a zero-length segment', () => {
    const spider = fake();
    const goal = routeGoal(spider, [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ]);
    expect(goal.controls()).toEqual({ throttle: 0, turn: 0, lift: 0, boost: 0 });
    expect(goal.done()).toBe(true);
  });

  it('gives up when stuck and reports the halt', () => {
    const spider = fake({ stuckFor: STUCK_LIMIT, halt: 'steep' });
    const goal = routeGoal(spider, [
      { x: 0, z: 0 },
      { x: 0, z: -10 },
    ]);
    expect(goal.done()).toBe(true);
    expect(goal.result()).toEqual({ halt: 'steep' });
  });
});

describe('heightGoal', () => {
  it('clamps the target to the deck range', () => {
    expect(heightGoal(fake(), 5).result()).toEqual({ target: 0.7, achieved: 0 });
    expect(heightGoal(fake(), -5).result()).toEqual({ target: -0.35, achieved: 0 });
  });

  it('lifts while below the target', () => {
    expect(heightGoal(fake(), 0.5).controls()).toEqual({
      throttle: 0,
      turn: 0,
      lift: 1,
      boost: 0,
    });
    expect(heightGoal(fake(), 0.5).done()).toBe(false);
  });

  it('lowers while above the target', () => {
    expect(heightGoal(fake({ heightSet: 0.6 }), 0.2).controls().lift).toBe(-1);
  });

  it('finishes when close to the target', () => {
    const goal = heightGoal(fake({ heightSet: 0.2 }), 0.2);
    expect(goal.done()).toBe(true);
    expect(goal.result()).toEqual({ target: 0.2, achieved: 0.2 });
  });
});
