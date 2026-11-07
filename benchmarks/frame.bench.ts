// @vitest-environment node

import { describe, test } from 'vitest';
import { SimSession } from '../src/shared/sim/session.js';
import { SEED, stepDriven } from '../tests/perf/scenarios.js';

const session = new SimSession(SEED);
const home = session.spider.capture();

describe('driven frames', () => {
  test('120 driven frames', async ({ bench }) => {
    await bench('120 driven frames', () => {
      session.spider.settle(home);
      stepDriven(session);
    }).run();
  });
});

// Reset all loose bodies as well as the spider. Repeated samples must not
// quietly turn a moving-world scenario into an already settled idle world.
test('120 driven frames from the same complete snapshot', async ({ bench }) => {
  const { applyBody, captureBody } = await import('../src/shared/sim/snapshot.js');
  const { Terrain } = await import('../src/shared/terrain.js');
  const target = new SimSession(SEED);
  const body = captureBody(target, null);
  const terrain = new Terrain(SEED);
  await bench(
    '120 driven frames (reset whole world)',
    {
      beforeEach: () => {
        applyBody(target, body, terrain);
      },
    },
    () => {
      stepDriven(target);
    },
  ).run();
});
