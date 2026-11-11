import { ActorPresenter } from '@/src/client/rig/presenter';
import { drive } from '@/tests/simHelpers';
import { test } from 'vitest';
import { SimSession } from '@/src/shared/sim/session';
import { SEED, stepDriven } from '@/tests/perf/scenarios';

test('120 driven frames from the same complete snapshot', async ({ bench }) => {
  const { applyBody, captureBody } = await import('@/src/shared/sim/snapshot');
  const { Terrain } = await import('@/src/shared/terrain');
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

test('120 world and browser animation steps', async ({ bench }) => {
  let session: SimSession;
  let presenter: ActorPresenter;
  await bench(
    '120 world + rig steps',
    {
      beforeEach: () => {
        session = new SimSession(SEED);
        presenter = new ActorPresenter(session);
      },
    },
    () => {
      void drive(session, 4, { throttle: 1 });
      try {
        for (let i = 0; i < 120; i++) presenter.step(1 / 60);
      } finally {
        session.cancel();
      }
    },
  ).run();
});
