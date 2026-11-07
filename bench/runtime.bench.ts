// @vitest-environment node

import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { EcologySky } from '../src/client/ecologyView.js';
import { worldClock } from '../src/shared/ecology.js';
import { blockAt } from '../src/shared/sight.js';
import { SimSession } from '../src/shared/sim/session.js';
import { stepPhysics } from '../src/shared/sim/physics.js';
import { applyBody, captureBody } from '../src/shared/sim/snapshot.js';
import { Terrain } from '../src/shared/terrain.js';
import { SEED } from '../tests/perf/scenarios.js';

const session = new SimSession(SEED);
const body = captureBody(session, null);
const terrain = new Terrain(SEED);

describe('runtime hot paths', () => {
  test('120 sky animation updates', async ({ bench }) => {
    const sky = new EcologySky();
    const clock = worldClock(new Date(2026, 10, 7, 12));
    const focus = new Vector3();
    try {
      await bench('120 sky updates', () => {
        for (let i = 0; i < 120; i++) sky.update(clock, focus, false, 1 / 60);
      }).run();
    } finally {
      sky.dispose();
    }
  });

  test('120 loose-body physics steps with a moving spider', async ({ bench }) => {
    expect(session.world.entities.filter((entity) => entity.kind === 'apple').length).toBe(20);
    await bench(
      '120 physics steps (reset whole world)',
      {
        beforeEach: () => {
          applyBody(session, body, terrain);
        },
      },
      () => {
        for (let i = 0; i < 120; i++) {
          stepPhysics(session.world, { x: 0, z: -i / 60, speed: 1 }, 1 / 60);
        }
      },
    ).run();
  });

  test('probe walls along a moving body path', async ({ bench }) => {
    expect(session.world.blocks.length).toBeGreaterThan(40);
    await bench('120 wall probes', () => {
      for (let i = 0; i < 120; i++) blockAt(i / 10 - 6, -4, session.world.blocks);
    }).run();
  });
});
