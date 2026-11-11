import { indexEntities } from '@/src/shared/world';
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { groundSupport } from '@/src/shared/contact';
import { CONTACT, PHYSICS } from '@/src/shared/config';
import { KINDS } from '@/src/shared/kinds';
import { fitsPlacement, stepPhysics } from '@/src/shared/sim/physics';
import type { Block, EntityState, WorldState } from '@/src/shared/state';

const body = { x: 100, z: 100, speed: 0 };
const APPLE_RADIUS = KINDS.apple.physics!.radius;

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
    entities: new Map(),
    entitySerials: new Map(),
    blocks: [],
    marks: [],
    tethers: new Map(),
    populations: new Map(),
    physics: PHYSICS,
    ...over,
  };
}

const wall: Block = { id: 'wall', minX: 1, maxX: 2, minZ: -1, maxZ: 1, height: 1 };

it('checks placement clearance for records without a registered collision radius', () => {
  const cargo = item('unregistered-cargo');
  const other = item('unregistered-scenery', { x: 0.3 });
  const state = world({ entities: indexEntities([cargo, other]) });
  expect(fitsPlacement(state, cargo, 0, 0)).toBe(false);
  expect(fitsPlacement(state, cargo, -0.5, 0)).toBe(true);
});

describe('stepPhysics', () => {
  it('samples each slope neighbor once for an active grounded body', () => {
    const samples: [number, number][] = [];
    const flat = world({
      terrain: {
        height: (x, z) => {
          samples.push([x, z]);
          return 0;
        },
      },
      entities: indexEntities([apple({ x: 2, y: CONTACT, z: 3 })]),
    });
    stepPhysics(flat, { x: 100, z: 100, speed: 2 }, 1 / 60);
    expect(samples).toHaveLength(7);
    for (const [x, z] of [
      [2.6, 3],
      [1.4, 3],
      [2, 3.6],
      [2, 2.4],
    ]) {
      expect(samples.filter(([px, pz]) => px === x && pz === z)).toHaveLength(1);
    }
    expect([...flat.entities.values()][0]).toMatchObject({
      x: 2,
      y: CONTACT,
      z: 3,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  });

  it('keeps a zero-radius body on the ground without a contact skin', () => {
    KINDS.point = {
      properties: [],
      rest: 0,
      physics: { solid: true, radius: 0, loose: true, rolls: false },
    };
    try {
      const flat = world({
        entities: indexEntities([item('point', { x: 2, y: 0.25 })]),
        terrain: { height: () => 0.25 },
      });
      stepPhysics(flat, body, 1 / 60);
      expect([...flat.entities.values()][0].y).toBe(0.25);
    } finally {
      delete KINDS.point;
    }
  });

  it('does nothing without time or movers', () => {
    const quiet = world({ entities: indexEntities([item('grass')]) });
    stepPhysics(quiet, body, 0);
    stepPhysics(quiet, body, 1 / 60);
    expect([...quiet.entities.values()][0]).toMatchObject({ x: 0, z: 0 });
    const empty = world();
    stepPhysics(empty, body, 1 / 60);
    expect(empty.entities.size).toBe(0);
  });

  it('spins a round body by the arc it travels, and leaves a slider unturned', () => {
    const slope = world({
      terrain: { height: (x: number) => x * 0.4 },
      entities: indexEntities([apple({ x: 3 })]),
    });
    stepPhysics(slope, body, 1 / 20);
    stepPhysics(slope, body, 1 / 20);
    const moved = [...slope.entities.values()][0];
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
        entities: indexEntities([item('slide', { x: 3 }), item('disk', { id: 'disk-1', x: 4 })]),
      });
      stepPhysics(sliding, body, 1 / 20);
      expect([...sliding.entities.values()][0].x).toBeLessThan(3);
      expect([...sliding.entities.values()][0].qx).toBeUndefined();
      expect([...sliding.entities.values()][1].qx).toBeUndefined();
    } finally {
      delete KINDS.slide;
      delete KINDS.disk;
    }
  });

  it('rests an apple on flat ground', () => {
    const flat = world({ entities: indexEntities([apple({ x: 2, z: 3 })]) });
    stepPhysics(flat, body, 1 / 60);
    expect([...flat.entities.values()][0]).toMatchObject({ x: 2, z: 3, y: CONTACT, vx: 0, vz: 0 });
  });

  it('floats a loose body with most of it underwater', () => {
    const pond = world({
      terrain: { height: () => -2, surface: () => -0.8, inside: () => true },
      entities: indexEntities([apple({ x: 2, z: 3 })]),
    });
    for (let i = 0; i < 600; i++) stepPhysics(pond, body, 1 / 60);
    const floated = [...pond.entities.values()][0];
    expect(floated).toMatchObject({ x: 2, z: 3, vx: 0, vz: 0 });
    expect(floated.y).toBeCloseTo(-1.17, 1);
    expect(floated.y + APPLE_RADIUS).toBeLessThan(-0.8);
  });

  it('floats bodies by their own mass and volume, not by kind', () => {
    KINDS.light = {
      properties: [],
      rest: 0,
      physics: { solid: true, radius: 0.36, loose: true, rolls: false, mass: 0.1, volume: 0.2 },
    };
    KINDS.heavy = {
      properties: [],
      rest: 0,
      physics: { solid: true, radius: 0.36, loose: true, rolls: false, mass: 0.18, volume: 0.2 },
    };
    try {
      const pond = world({
        terrain: { height: () => -3, surface: () => -0.8, inside: () => true },
        entities: indexEntities([item('light', { x: 1 }), item('heavy', { x: 3 })]),
      });
      for (let i = 0; i < 900; i++) stepPhysics(pond, body, 1 / 60);
      const light = [...pond.entities.values()][0];
      const heavy = [...pond.entities.values()][1];
      expect(light.y).toBeGreaterThan(heavy.y);
      expect(light.y).toBeGreaterThan(-1.3);
      expect(heavy.y).toBeLessThan(-1.35);
    } finally {
      delete KINDS.light;
      delete KINDS.heavy;
    }
  });

  it('slows a floating body with water drag', () => {
    const dry = world({ entities: indexEntities([apple({ x: 2, z: 3, vx: 2 })]) });
    const wet = world({
      terrain: { height: () => -2, surface: () => -0.8, inside: () => true },
      entities: indexEntities([apple({ x: 2, z: 3, vx: 2, y: -0.8 })]),
    });
    for (let i = 0; i < 30; i++) {
      stepPhysics(dry, body, 1 / 60);
      stepPhysics(wet, body, 1 / 60);
    }
    expect([...wet.entities.values()][0].vx!).toBeLessThan([...dry.entities.values()][0].vx!);
    expect([...wet.entities.values()][0].x).toBeLessThan([...dry.entities.values()][0].x);
  });

  it('stops a loose body at the round island edge', () => {
    const land = (x: number, z: number, margin = 0): boolean => Math.hypot(x, z) < 6 - margin;
    const edge = world({
      terrain: { height: () => 0, inside: land },
      entities: indexEntities([apple({ x: 5.5, vx: 2 })]),
    });
    stepPhysics(edge, body, 1 / 2);
    expect([...edge.entities.values()][0].x).toBeCloseTo(6 - APPLE_RADIUS, 6);
    expect([...edge.entities.values()][0].vx).toBe(0);

    const shoved = world({
      terrain: { height: () => 0, inside: land },
      entities: indexEntities([apple({ x: 5.55 })]),
    });
    stepPhysics(shoved, { x: 5.15, z: 0, speed: 10 }, 1 / 60);
    expect([...shoved.entities.values()][0].x).toBeCloseTo(6 - APPLE_RADIUS, 6);

    const pair = world({
      terrain: { height: () => 0, inside: land },
      entities: indexEntities([apple({ id: 'a', x: 5.7 }), apple({ id: 'b', x: 5.3 })]),
    });
    stepPhysics(pair, body, 1 / 60);
    expect([...pair.entities.values()][0].x).toBeCloseTo(6 - APPLE_RADIUS, 6);
    expect([...pair.entities.values()][0].vx).toBe(0);
  });

  it('rolls an apple downhill and pins it to the ground', () => {
    const slope = world({
      terrain: { height: (x: number) => x * 0.2 },
      entities: indexEntities([apple({ x: 5 })]),
    });
    for (let i = 0; i < 30; i++) stepPhysics(slope, body, 1 / 60);
    const moved = [...slope.entities.values()][0];
    expect(moved.x).toBeLessThan(5);
    expect(moved.vx).toBeLessThan(0);
    expect(moved.y).toBeCloseTo(
      groundSupport(slope.terrain.height, moved.x, moved.z, APPLE_RADIUS),
    );
  });

  it('builds speed down a gentle slope instead of cancelling the first shove', () => {
    const gentle = world({
      terrain: { height: (x: number) => x * 0.1 },
      entities: indexEntities([apple({ x: 4, vz: 0.2 })]),
    });
    for (let i = 0; i < 40; i++) stepPhysics(gentle, body, 1 / 60);
    expect([...gentle.entities.values()][0].x).toBeLessThan(4);
    expect([...gentle.entities.values()][0].vx).toBeLessThan(0);
  });

  it('caps a very fast prop', () => {
    const fast = world({ entities: indexEntities([apple({ x: 3, vx: 100 })]) });
    stepPhysics(fast, body, 1 / 60);
    expect(
      Math.hypot([...fast.entities.values()][0].vx ?? 0, [...fast.entities.values()][0].vz ?? 0),
    ).toBeLessThanOrEqual(PHYSICS.maxSpeed);
  });

  it('stops at a solid wall', () => {
    const blocked = world({ entities: indexEntities([apple({ x: 0.8, vx: 5 })]), blocks: [wall] });
    stepPhysics(blocked, body, 1 / 60);
    expect([...blocked.entities.values()][0].vx).toBe(0);
    expect([...blocked.entities.values()][0].vz).toBe(0);
    expect([...blocked.entities.values()][0].x).toBe(0.8);
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
    const pushed = world({ entities: indexEntities([apple({ x: 0.2 })]), blocks: [beside] });
    stepPhysics(pushed, { x: 0, z: 0, speed: 2 }, 1 / 60);
    expect([...pushed.entities.values()][0].x).toBeCloseTo(0.2);
  });

  it('pushes an apple out of the spider', () => {
    const pushed = world({ entities: indexEntities([apple({ x: 0.2 })]) });
    stepPhysics(pushed, { x: 0, z: 0, speed: 2 }, 1 / 60);
    const moved = [...pushed.entities.values()][0];
    expect(Math.hypot(moved.x, moved.z)).toBeGreaterThanOrEqual(0.48 + APPLE_RADIUS - 1e-9);
    expect(moved.vx).toBeGreaterThan(0);
  });

  it('pushes apart from the exact same spot', () => {
    const same = world({ entities: indexEntities([apple({ x: 0, z: 0 })]) });
    stepPhysics(same, { x: 0, z: 0, speed: 1 }, 1 / 60);
    expect(
      Math.hypot([...same.entities.values()][0].x, [...same.entities.values()][0].z),
    ).toBeGreaterThan(0);
  });

  it('separates two overlapping apples', () => {
    const pair = world({
      entities: indexEntities([apple({ id: 'a', x: 0 }), apple({ id: 'b', x: 0.1 })]),
    });
    stepPhysics(pair, body, 1 / 60);
    const [a, b] = pair.entities.values();
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.1);
  });

  it('keeps overlapping props separated after repeated frames', () => {
    const pair = world({
      entities: indexEntities([apple({ id: 'a', x: 0 }), apple({ id: 'b', x: 0.1 })]),
    });
    for (let i = 0; i < 60; i++) stepPhysics(pair, body, 1 / 60);
    const [a, b] = pair.entities.values();
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThanOrEqual(2 * APPLE_RADIUS - 1e-6);
  });

  it('resolves a collision toward the side with room at a shore', () => {
    const land = (x: number, z: number, margin = 0): boolean => Math.hypot(x, z) < 6 - margin;
    const shore = world({
      terrain: { height: () => 0, inside: land },
      entities: indexEntities([apple({ id: 'a', x: 5.55 }), apple({ id: 'b', x: 5.72 })]),
    });
    stepPhysics(shore, body, 1 / 60);
    const [inner, outer] = shore.entities.values();
    expect(inner.x).toBeLessThan(5.55);
    expect(outer.x).toBeLessThanOrEqual(6 - APPLE_RADIUS);
    expect(Math.hypot(inner.x - outer.x, inner.z - outer.z)).toBeGreaterThanOrEqual(
      2 * APPLE_RADIUS - 1e-6,
    );
    expect(land(inner.x, inner.z, APPLE_RADIUS)).toBe(true);
  });

  it('ignores two apples at one exact point', () => {
    const pair = world({ entities: indexEntities([apple({ id: 'a' }), apple({ id: 'b' })]) });
    stepPhysics(pair, body, 1 / 60);
    expect(Number.isFinite([...pair.entities.values()][0].x)).toBe(true);
    expect(Number.isFinite([...pair.entities.values()][1].x)).toBe(true);
  });

  it('lets a stack of apples rest instead of shaking', () => {
    const pile = world({
      entities: indexEntities([
        apple({ id: 'a', x: 0, z: 0, y: 0.08 }),
        apple({ id: 'b', x: 0, z: 0, y: 2 }),
        apple({ id: 'c', x: 0.02, z: -0.01, y: 3.4 }),
      ]),
    });
    for (let i = 0; i < 240; i++) stepPhysics(pile, body, 1 / 60);
    const samples: number[][] = [[], [], []];
    for (let i = 0; i < 60; i++) {
      stepPhysics(pile, body, 1 / 60);
      [...pile.entities.values()].forEach((entity, index) => samples[index].push(entity.y));
    }
    for (const column of samples) {
      const span = Math.max(...column) - Math.min(...column);
      expect(span).toBeLessThan(0.01);
    }
    for (const entity of pile.entities.values()) {
      expect(Math.hypot(entity.vx ?? 0, entity.vy ?? 0, entity.vz ?? 0)).toBeLessThan(0.05);
    }
    const centers = [...pile.entities.values()].map((entity) => ({
      x: entity.x,
      y: entity.y + APPLE_RADIUS,
      z: entity.z,
    }));
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const a = centers[i];
        const b = centers[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        expect(dist).toBeGreaterThanOrEqual(2 * APPLE_RADIUS - 1e-4);
      }
    }
    const ys = [...pile.entities.values()].map((entity) => entity.y);
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys) + 0.5);
  });

  it('lets the lower apple be second in the list', () => {
    const pile = world({
      entities: indexEntities([
        apple({ id: 'top', x: 0, z: 0, y: 2 }),
        apple({ id: 'low', x: 0.04, z: 0, y: 0.08 }),
      ]),
    });
    for (let i = 0; i < 180; i++) stepPhysics(pile, body, 1 / 60);
    const [top, low] = pile.entities.values();
    expect(top.y).toBeGreaterThan(low.y + 0.5);
    expect(Math.hypot(top.vx ?? 0, top.vy ?? 0, top.vz ?? 0)).toBeLessThan(0.05);
  });

  it('shares a fall between two apples that are both in the air', () => {
    const pair = world({
      entities: indexEntities([
        apple({ id: 'a', y: 1, vy: -0.4 }),
        apple({ id: 'b', x: 0.05, y: 1.15, vy: -0.2 }),
      ]),
    });
    stepPhysics(pair, body, 1 / 60);
    expect(Number.isFinite([...pair.entities.values()][0].vy)).toBe(true);
    expect(Number.isFinite([...pair.entities.values()][1].vy)).toBe(true);
  });

  it('settles a cluster of apples on the ground', () => {
    const cluster = world({
      entities: indexEntities([
        apple({ id: 'a', x: 0, z: 0 }),
        apple({ id: 'b', x: 0.15, z: 0.05 }),
        apple({ id: 'c', x: -0.1, z: 0.12 }),
        apple({ id: 'd', x: 0.05, z: -0.14 }),
      ]),
    });
    for (let i = 0; i < 120; i++) stepPhysics(cluster, body, 1 / 60);
    const marks = [...cluster.entities.values()].map((entity) => ({ x: entity.x, z: entity.z }));
    for (let i = 0; i < 30; i++) stepPhysics(cluster, body, 1 / 60);
    for (let i = 0; i < marks.length; i++) {
      const entity = [...cluster.entities.values()][i];
      expect(Math.hypot(entity.x - marks[i].x, entity.z - marks[i].z)).toBeLessThan(0.01);
      expect(Math.hypot(entity.vx ?? 0, entity.vz ?? 0)).toBeLessThan(0.02);
    }
  });

  it('does not push two apples through a wall that pens them in', () => {
    const pen = world({
      blocks: [
        { id: 'left', minX: -2, maxX: -0.05, minZ: -1, maxZ: 1, height: 1 },
        { id: 'right', minX: 0.55, maxX: 2, minZ: -1, maxZ: 1, height: 1 },
      ],
      entities: indexEntities([apple({ id: 'a', x: 0.05 }), apple({ id: 'b', x: 0.3 })]),
    });
    stepPhysics(pen, body, 1 / 60);
    expect([...pen.entities.values()][0].x).toBeGreaterThan(-0.05);
    expect([...pen.entities.values()][1].x).toBeLessThan(0.55);
    expect(Number.isFinite([...pen.entities.values()][0].y)).toBe(true);
  });

  it('stops two apples that are still moving into each other', () => {
    const closing = world({
      entities: indexEntities([
        apple({ id: 'a', x: 0, vx: 1 }),
        apple({ id: 'b', x: 0.2, vx: -1 }),
      ]),
    });
    stepPhysics(closing, body, 1 / 60);
    const [a, b] = closing.entities.values();
    const rel = (b.vx ?? 0) - (a.vx ?? 0);
    expect(rel).toBeGreaterThanOrEqual(-1e-6);
  });

  it('leaves apples alone when they are already moving apart', () => {
    const opening = world({
      entities: indexEntities([
        apple({ id: 'a', x: 0, vx: -1 }),
        apple({ id: 'b', x: 0.2, vx: 1 }),
      ]),
    });
    stepPhysics(opening, body, 1 / 60);
    expect([...opening.entities.values()][0].vx).toBeLessThan(0);
    expect([...opening.entities.values()][1].vx).toBeGreaterThan(0);
  });

  it('uses the default rules on a hand-built world', () => {
    const hand = world();
    delete hand.physics;
    hand.entities = indexEntities([apple({ x: 5 })]);
    hand.terrain = { height: (x: number) => x * 0.2 };
    stepPhysics(hand, body, 1 / 60);
    expect([...hand.entities.values()][0].vx).toBeLessThan(0);
  });
});

it('normalizes a degenerate stored orientation when a round body starts rolling', () => {
  const cargo = apple({ x: 3, qx: 0, qy: 0, qz: 0, qw: 0 });
  const slope = world({ terrain: { height: (x) => x * 0.4 }, entities: indexEntities([cargo]) });
  stepPhysics(slope, body, 0.05);
  expect(cargo.x).toBeLessThan(3);
  expect([cargo.qx, cargo.qy, cargo.qz, cargo.qw]).toEqual([0, 0, 0, 1]);
});
