// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  toHeading,
  toNear,
  toObservation,
  toSense,
  wrapDegrees,
  type EntityState,
  type SpiderState,
  type WorldState,
} from '../../src/shared/state.js';
import { block, flat } from '../helpers.js';

function spider(over: Partial<SpiderState> = {}): SpiderState {
  return {
    time: 1.23456,
    position: { x: 0, y: 0.5, z: 0 },
    yaw: 0,
    speed: 1.2345,
    height: 0.25,
    chassisPitch: 0,
    chassisRoll: 0,
    headYaw: 0,
    feet: [
      { x: 0, y: 0.5, z: 0 },
      { x: 1, y: 0.1, z: 1 },
    ],
    ...over,
  };
}

function world(over: Partial<WorldState> = {}): WorldState {
  return {
    seed: 7,
    terrain: { height: flat },
    entities: [],
    blocks: [],
    carrying: [],
    ...over,
  };
}

const apple = (over: Partial<EntityState> = {}): EntityState => ({
  id: 'apple-1',
  kind: 'apple',
  x: 2,
  y: 0.5,
  z: -3,
  stage: 1,
  ...over,
});

describe('angles', () => {
  it('turns a three.js yaw into a compass heading', () => {
    expect(toHeading(0)).toBe(0);
    expect(toHeading(-Math.PI / 2)).toBe(90);
    expect(toHeading(Math.PI / 2)).toBe(-90);
  });

  it('wraps to (-180, 180]', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(370)).toBe(10);
    expect(wrapDegrees(-370)).toBe(-10);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
  });
});

describe('toSense', () => {
  it('reports the body without the island around it', () => {
    const worldState = world({ entities: [apple()] });
    const sense = toSense(spider(), worldState);
    expect(sense).toMatchObject({ x: 0, z: 0, heading: 0, home: true });
    expect(sense.ahead).toEqual({ open: 8, by: 'clear', id: null, kind: null });
    expect(sense).not.toHaveProperty('entities');
    expect(sense).not.toHaveProperty('nearby');
    expect(sense).not.toHaveProperty('ways');
  });

  it('lists what is carried and reports grass cover', () => {
    const grass: EntityState = {
      id: 'grass-1',
      kind: 'grass',
      x: 0,
      y: 0,
      z: 0,
      stage: 0,
      footprint: { kind: 'circle', r: 2 },
    };
    const sense = toSense(
      spider(),
      world({
        entities: [grass],
        carrying: [apple({ id: 'apple-back', stage: 2 })],
      }),
    );
    expect(sense.cover).toBe('grass');
    expect(sense.carrying).toEqual([
      { id: 'apple-back', kind: 'apple', stage: 2, properties: ['edible', 'carryable'] },
    ]);
  });

  it('can attach walkable ways', () => {
    const sense = toSense(spider(), world(), true);
    expect(sense.ways?.length).toBeGreaterThan(0);
  });
});

describe('toObservation', () => {
  it('describes a visible entity in reach', () => {
    const seen = toObservation(spider(), world({ entities: [apple()] }), 4, 16, 1.6);
    expect(seen.beyond).toBe(0);
    expect(seen.hidden).toBe(0);
    expect(seen.entities).toHaveLength(1);
    expect(seen.entities[0]).toMatchObject({
      id: 'apple-1',
      kind: 'apple',
      x: 2,
      y: 0.5,
      z: -3,
      stage: 1,
      properties: ['edible', 'carryable'],
      distance: 3.606,
      bearing: 33.7,
      inReach: true,
    });
    expect(seen.time).toBe(1.235);
    expect(seen.view).toBe(16);
    expect(seen.self).toMatchObject({
      x: 0,
      y: 0.5,
      z: 0,
      ground: 0,
      heading: 0,
      height: 0.25,
      speed: 1.235,
      cover: null,
      home: true,
    });
  });

  it('counts things past the view', () => {
    const seen = toObservation(spider(), world({ entities: [apple()] }), 4, 1, 1.6);
    expect(seen.beyond).toBe(1);
    expect(seen.hidden).toBe(0);
    expect(seen.entities).toEqual([]);
  });

  it('counts things behind a solid', () => {
    const wall = block('wall', 0.5, 1.5, -2, -1);
    const seen = toObservation(
      spider(),
      world({ entities: [apple()], blocks: [wall] }),
      4,
      16,
      1.6,
    );
    expect(seen.hidden).toBe(1);
    expect(seen.entities).toEqual([]);
  });

  it('does not let the target itself hide it', () => {
    const seen = toObservation(
      spider(),
      world({ entities: [apple()], blocks: [block('apple-1', 1.5, 2.5, -3.5, -2.5)] }),
      4,
      16,
      1.6,
    );
    expect(seen.entities).toHaveLength(1);
  });

  it('marks a high thing out of reach', () => {
    const high = apple({ y: 3 });
    const seen = toObservation(spider(), world({ entities: [high] }), 4, 16, 1.6);
    expect(seen.entities[0].inReach).toBe(false);
  });

  it('marks a distant thing out of reach', () => {
    const seen = toObservation(spider(), world({ entities: [apple()] }), 1, 16, 1.6);
    expect(seen.entities[0].inReach).toBe(false);
  });

  it('reports grass cover and a position outside home', () => {
    const grass: EntityState = {
      id: 'grass-1',
      kind: 'grass',
      x: 5,
      y: 0,
      z: 0,
      stage: 0,
      footprint: { kind: 'circle', r: 2 },
    };
    const seen = toObservation(
      spider({ position: { x: 5, y: 1, z: 0 }, feet: [] }),
      world({ entities: [grass] }),
      4,
      16,
      1.6,
    );
    expect(seen.self.cover).toBe('grass');
    expect(seen.self.home).toBe(false);
  });

  it('lists what is carried, oldest first', () => {
    const carried = apple({ id: 'apple-2', stage: 2 });
    const seen = toObservation(spider(), world({ carrying: [carried] }), 4, 16, 1.6);
    expect(seen.self.carrying).toEqual([
      { id: 'apple-2', kind: 'apple', stage: 2, properties: ['edible', 'carryable'] },
    ]);
  });

  it('lists what you can act on within reach, nearest first', () => {
    const grass: EntityState = {
      id: 'grass-1',
      kind: 'grass',
      x: 0,
      y: 0,
      z: 0,
      stage: 0,
      footprint: { kind: 'circle', r: 2 },
    };
    const near = toNear(
      spider(),
      world({
        entities: [
          apple({ id: 'apple-b', x: 0.5, z: 0.5, stage: 0 }),
          apple({ id: 'apple-far', z: -4 }),
          apple({ id: 'apple-high', y: 3, z: -0.4 }),
          apple({ id: 'apple-hidden', x: 1.05, z: 0, stage: 0 }),
          apple({ id: 'apple-a', x: 0, z: -0.5, stage: 1 }),
          grass,
          apple({ id: 'home', kind: 'nest', x: 0, y: 0.02, z: 0, stage: 0 }),
          apple({ id: 'rock-1', kind: 'rock', x: 0.3, z: 0, stage: 0 }),
        ],
        blocks: [block('wall', 0.4, 0.7, -0.25, 0.25)],
      }),
      1.2,
      1.6,
    );
    expect(near).toEqual([
      {
        id: 'apple-a',
        kind: 'apple',
        stage: 1,
        properties: ['edible', 'carryable'],
        distance: 0.5,
        bearing: 0,
      },
      {
        id: 'apple-b',
        kind: 'apple',
        stage: 0,
        properties: ['edible', 'carryable'],
        distance: 0.707,
        bearing: 135,
      },
    ]);
  });

  it('gives an unknown kind no properties', () => {
    const rock = apple({ id: 'rock-1', kind: 'rock' });
    const seen = toObservation(spider(), world({ entities: [rock] }), 4, 16, 1.6);
    expect(seen.entities[0].properties).toEqual([]);
  });
});
