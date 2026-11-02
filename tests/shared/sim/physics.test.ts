// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { PHYSICS } from '../../../src/shared/config.js';
import { KINDS } from '../../../src/shared/kinds.js';
import { stepPhysics } from '../../../src/shared/sim/physics.js';
import type { Block, EntityState, WorldState } from '../../../src/shared/state.js';

const body = { x: 100, z: 100, speed: 0 };

function apple(over: Partial<EntityState> = {}): EntityState {
  return { id: 'apple-1', kind: 'apple', x: 0, y: 0, z: 0, stage: 0, ...over };
}

function item(kind: string, over: Partial<EntityState> = {}): EntityState {
  return { id: `${kind}-1`, kind, x: 0, y: 0, z: 0, stage: 0, ...over };
}

function world(over: Partial<WorldState> = {}): WorldState {
  return {
    seed: 1,
    terrain: { height: () => 0 },
    entities: [],
    blocks: [],
    carrying: [],
    physics: PHYSICS,
    ...over,
  };
}

const wall: Block = { id: 'wall', minX: 1, maxX: 2, minZ: -1, maxZ: 1, height: 1 };

describe('stepPhysics', () => {
  it('does nothing without time or movers', () => {
    const quiet = world({ entities: [item('grass')] });
    stepPhysics(quiet, body, 0);
    stepPhysics(quiet, body, 1 / 60);
    expect(quiet.entities[0]).toMatchObject({ x: 0, z: 0 });
    const empty = world();
    stepPhysics(empty, body, 1 / 60);
    expect(empty.entities).toEqual([]);
  });

  it('spins a round body by the arc it travels, and leaves a slider unturned', () => {
    const slope = world({
      terrain: { height: (x: number) => x * 0.4 },
      entities: [apple({ x: 3 })],
    });
    stepPhysics(slope, body, 1 / 20);
    stepPhysics(slope, body, 1 / 20);
    const moved = slope.entities[0];
    const dx = moved.x - 3;
    expect(dx).toBeLessThan(0);
    const bottom = new Vector3(0, -1, 0).applyQuaternion(
      new Quaternion(moved.qx, moved.qy, moved.qz, moved.qw),
    );
    expect(Math.sign(bottom.x)).toBe(Math.sign(-dx));

    KINDS.slide = {
      properties: [],
      rest: 0,
      physics: { solid: true, radius: 0.2, loose: true, rolls: false },
    };
    KINDS.disk = {
      properties: [],
      rest: 0,
      physics: { solid: true, radius: 0, loose: true, rolls: true },
    };
    try {
      const sliding = world({
        terrain: { height: (x: number) => x * 0.4 },
        entities: [item('slide', { x: 3 }), item('disk', { id: 'disk-1', x: 4 })],
      });
      stepPhysics(sliding, body, 1 / 20);
      expect(sliding.entities[0].x).toBeLessThan(3);
      expect(sliding.entities[0].qx).toBeUndefined();
      expect(sliding.entities[1].qx).toBeUndefined();
    } finally {
      delete KINDS.slide;
      delete KINDS.disk;
    }
  });

  it('rests an apple on flat ground', () => {
    const flat = world({ entities: [apple({ x: 2, z: 3 })] });
    stepPhysics(flat, body, 1 / 60);
    expect(flat.entities[0]).toMatchObject({ x: 2, z: 3, y: 0.08, vx: 0, vz: 0 });
  });

  it('rolls an apple downhill and pins it to the ground', () => {
    const slope = world({
      terrain: { height: (x: number) => x * 0.2 },
      entities: [apple({ x: 5 })],
    });
    for (let i = 0; i < 30; i++) stepPhysics(slope, body, 1 / 60);
    const moved = slope.entities[0];
    expect(moved.x).toBeLessThan(5);
    expect(moved.vx).toBeLessThan(0);
    expect(moved.y).toBeCloseTo(slope.terrain.height(moved.x, moved.z) + 0.08);
  });

  it('builds speed down a gentle slope instead of cancelling the first shove', () => {
    const gentle = world({
      terrain: { height: (x: number) => x * 0.1 },
      entities: [apple({ x: 4, vz: 0.2 })],
    });
    for (let i = 0; i < 40; i++) stepPhysics(gentle, body, 1 / 60);
    expect(gentle.entities[0].x).toBeLessThan(4);
    expect(gentle.entities[0].vx).toBeLessThan(0);
  });

  it('caps a very fast prop', () => {
    const fast = world({ entities: [apple({ x: 3, vx: 100 })] });
    stepPhysics(fast, body, 1 / 60);
    expect(Math.hypot(fast.entities[0].vx ?? 0, fast.entities[0].vz ?? 0)).toBeLessThanOrEqual(
      PHYSICS.maxSpeed,
    );
  });

  it('stops at a solid wall', () => {
    const blocked = world({ entities: [apple({ x: 0.8, vx: 5 })], blocks: [wall] });
    stepPhysics(blocked, body, 1 / 60);
    expect(blocked.entities[0].vx).toBe(0);
    expect(blocked.entities[0].vz).toBe(0);
    expect(blocked.entities[0].x).toBe(0.8);
  });

  it('does not push a loose body through a wall', () => {
    const beside = {
      id: 'wall',
      minX: 0.3,
      maxX: 2,
      minZ: -1,
      maxZ: 1,
      height: 1,
    };
    const pushed = world({ entities: [apple({ x: 0.2 })], blocks: [beside] });
    stepPhysics(pushed, { x: 0, z: 0, speed: 2 }, 1 / 60);
    expect(pushed.entities[0].x).toBeCloseTo(0.2);
  });

  it('pushes an apple out of the spider', () => {
    const pushed = world({ entities: [apple({ x: 0.2 })] });
    stepPhysics(pushed, { x: 0, z: 0, speed: 2 }, 1 / 60);
    const moved = pushed.entities[0];
    expect(Math.hypot(moved.x, moved.z)).toBeGreaterThanOrEqual(0.48 + 0.36 - 1e-9);
    expect(moved.vx).toBeGreaterThan(0);
  });

  it('pushes apart from the exact same spot', () => {
    const same = world({ entities: [apple({ x: 0, z: 0 })] });
    stepPhysics(same, { x: 0, z: 0, speed: 1 }, 1 / 60);
    expect(Math.hypot(same.entities[0].x, same.entities[0].z)).toBeGreaterThan(0);
  });

  it('separates two overlapping apples', () => {
    const pair = world({
      entities: [apple({ id: 'a', x: 0 }), apple({ id: 'b', x: 0.1 })],
    });
    stepPhysics(pair, body, 1 / 60);
    const [a, b] = pair.entities;
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.1);
  });

  it('ignores two apples at one exact point', () => {
    const pair = world({ entities: [apple({ id: 'a' }), apple({ id: 'b' })] });
    stepPhysics(pair, body, 1 / 60);
    expect(Number.isFinite(pair.entities[0].x)).toBe(true);
    expect(Number.isFinite(pair.entities[1].x)).toBe(true);
  });

  it('uses the default rules on a hand-built world', () => {
    const hand = world();
    delete hand.physics;
    hand.entities = [apple({ x: 5 })];
    hand.terrain = { height: (x: number) => x * 0.2 };
    stepPhysics(hand, body, 1 / 60);
    expect(hand.entities[0].vx).toBeLessThan(0);
  });
});
