import { describe, expect, test } from 'vitest';
import { surfaceOf } from '@/src/shared/terrain';
import { createWorld } from '@/src/shared/world';
import { planAroundNest, SEED } from '@/tests/perf/scenarios';

const world = createWorld(SEED);
const nestWalls = world.blocks.filter((wall) => wall.owner === 'home');
const height = (x: number, z: number): number => surfaceOf(world.terrain, x, z);

describe('route', () => {
  test('route around the nest', async ({ bench }) => {
    expect(planAroundNest(nestWalls, height)?.direct).toBe(false);
    await bench('route around the nest', () => {
      planAroundNest(nestWalls, height);
    }).run();
  });
});
