import { describe, test } from 'vitest';
import { toObservation, type SpiderState } from '@/src/shared/state';
import { Terrain } from '@/src/shared/terrain';
import { createWorld, REACH, REACH_Y, VIEW_DISTANCE } from '@/src/shared/world';

const seed = 12345;
const terrain = new Terrain(seed);
const world = createWorld(seed, terrain);
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
  test('observe the whole island', async ({ bench }) => {
    await bench('observe the whole island', () => {
      toObservation(state, world, REACH, VIEW_DISTANCE, REACH_Y);
    }).run();
  });
});
