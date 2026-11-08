import { describe, expect, test } from 'vitest';
import { CARRY_LIMIT, PHYSICS } from '@/src/shared/config';
import { stepPhysics } from '@/src/shared/sim/physics';
import { SimSession } from '@/src/shared/sim/session';
import { applyBody, captureBody } from '@/src/shared/sim/snapshot';
import type { EntityState, WorldState } from '@/src/shared/state';
import { Terrain } from '@/src/shared/terrain';
import { SEED, stepDriven } from '@/tests/perf/scenarios';

describe('loose-body scaling', () => {
  for (const count of [20, 40, 80, 160]) {
    test(`120 steps with ${count} loose bodies`, async ({ bench }) => {
      const entities: EntityState[] = Array.from({ length: count }, (_, i) => ({
        id: `apple-${i}`,
        kind: 'apple',
        stage: 0,
        x: (i % 12) * 1.3 - 7,
        y: 0.01,
        z: Math.floor(i / 12) * 1.3 - 7,
      }));
      const world: WorldState = {
        seed: SEED,
        terrain: { height: () => 0, inside: () => true },
        entities: [],
        carrying: [],
        blocks: [],
        marks: [],
        physics: PHYSICS,
      };
      const run = () => {
        for (let i = 0; i < 120; i++) stepPhysics(world, { x: 0, z: -i / 60, speed: 1 }, 1 / 60);
      };
      world.entities = structuredClone(entities);
      run();
      expect(world.entities).toHaveLength(count);
      expect(world.entities.every((entity) => Number.isFinite(entity.y))).toBe(true);
      await bench(
        `120 steps with ${count} loose bodies`,
        {
          beforeEach: () => {
            world.entities = structuredClone(entities);
          },
        },
        run,
      ).run();
    });
  }
});

describe('tethered cargo runtime', () => {
  for (const count of [0, 1, CARRY_LIMIT]) {
    test(`120 driven frames with ${count} tethered items`, async ({ bench }) => {
      const session = new SimSession(SEED);
      const apples = session.world.entities.filter((entity) => entity.kind === 'apple');
      session.world.carrying = apples.slice(0, count).map((item, i) => ({
        ...item,
        id: `cargo-${i}`,
      }));
      for (const [i, item] of session.world.carrying.entries()) {
        item.x = -2 - i * 0.3;
        item.z = 2 + i * 0.45;
      }
      const body = captureBody(session, null);
      const terrain = new Terrain(SEED);
      stepDriven(session);
      expect(session.world.carrying).toHaveLength(count);
      expect(session.world.carrying.every((item) => Number.isFinite(item.vx))).toBe(true);
      await bench(
        `120 driven frames with ${count} tethered items`,
        {
          beforeEach: () => {
            applyBody(session, body, terrain);
          },
        },
        () => {
          stepDriven(session);
        },
      ).run();
    });
  }
});
