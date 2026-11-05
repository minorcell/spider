// @vitest-environment node

import { describe, test } from 'vitest';
import { surfaceOf } from '../src/shared/terrain.js';
import { createWorld } from '../src/shared/world.js';
import { planAroundNest, SEED } from '../tests/perf/scenarios.js';

const world = createWorld(SEED);
const height = (x: number, z: number): number => surfaceOf(world.terrain, x, z);

describe('route', () => {
  test('route around the nest', async ({ bench }) => {
    await bench('route around the nest', () => {
      planAroundNest(world.blocks, height);
    }).run();
  });
});
