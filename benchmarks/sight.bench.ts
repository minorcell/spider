// @vitest-environment node

import { describe, test } from 'vitest';
import { EYE_HEIGHT, sightOutline } from '../src/shared/sight.js';
import { toObservation, type SpiderState } from '../src/shared/state.js';
import { surfaceOf, Terrain } from '../src/shared/terrain.js';
import { createWorld, REACH, REACH_Y, VIEW_DISTANCE } from '../src/shared/world.js';

const seed = 12345;
const terrain = new Terrain(seed);
const world = createWorld(seed, terrain);
const height = (x: number, z: number): number => terrain.height(x, z);
const eye = surfaceOf(terrain, 0, 0) + EYE_HEIGHT;
const state: SpiderState = {
  time: 0,
  position: { x: 0, y: terrain.height(0, 0), z: 0 },
  yaw: 0,
  speed: 0,
  height: 0,
  chassisPitch: 0,
  chassisRoll: 0,
  headYaw: 0,
  feet: [],
};

describe('sight', () => {
  test('trace a 72-bearing outline', async ({ bench }) => {
    await bench('trace a 72-bearing outline', () => {
      sightOutline(0, 0, eye, VIEW_DISTANCE, height, world.blocks, 72);
    }).run();
  });

  test('trace an outline without walls', async ({ bench }) => {
    await bench('trace an outline without walls', () => {
      sightOutline(0, 0, eye, VIEW_DISTANCE, height, [], 72);
    }).run();
  });

  test('observe the whole island', async ({ bench }) => {
    await bench('observe the whole island', () => {
      toObservation(state, world, REACH, VIEW_DISTANCE, REACH_Y);
    }).run();
  });
});
