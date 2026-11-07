import { describe, expect, it } from 'vitest';
import { islandGroup } from '../../src/client/groundView.js';
import {
  blankSession,
  dropOldest,
  estimateTokens,
  fit,
  transcript,
  type ChatSession,
  type CompactLimits,
} from '../../src/client/journal/session.js';
import { localDate } from '../../src/shared/dates.js';
import {
  applyBody,
  captureBody,
  classify,
  MAX_JSON,
  type WorldRecord,
} from '../../src/shared/sim/snapshot.js';
import { SimSession } from '../../src/shared/sim/session.js';
import { EYE_HEIGHT, sightOutline } from '../../src/shared/sight.js';
import { toObservation } from '../../src/shared/state.js';
import { surfaceOf, Terrain } from '../../src/shared/terrain.js';
import { createWorld, REACH, REACH_Y, VIEW_DISTANCE } from '../../src/shared/world.js';
import { bakeWorkerIsland, dressIsland, planAroundNest, SEED, stepDriven } from './scenarios.js';

function bestOf(runs: number, work: () => void, reset?: () => void): number {
  reset?.();
  work();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    reset?.();
    const start = performance.now();
    work();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function longDay(turns: number): ChatSession {
  return {
    ...blankSession('2026-11-02'),
    summary: '更早的摘要。'.repeat(20),
    turns: Array.from({ length: turns }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `这是第 ${index} 轮对话，${'内容'.repeat(20)}`,
      ...(index % 4 === 0 ? { tools: [{ name: 'look', input: {}, output: { ok: true } }] } : {}),
    })),
    updatedAt: Date.now(),
  };
}

const limits: CompactLimits = { contextTokens: 4_000 };
const day = longDay(400);

function recordOf(seed = 7): WorldRecord {
  const body = captureBody(new SimSession(seed), { text: '去巢边', tool: 'walk' });
  return {
    ...body,
    id: 'current',
    format: 3,
    savedAt: Date.now(),
    day: localDate(new Date()),
    owner: 'perf',
    seq: 1,
    leaseUntil: Date.now() + 60_000,
  };
}

const record = recordOf();
const wire = JSON.stringify(record);

describe('frame and boot budgets', () => {
  it('builds a seeded island in under 120 ms', () => {
    expect(bestOf(3, () => void new SimSession(1234))).toBeLessThan(120);
  });

  it('steps 120 idle frames in under 120 ms', () => {
    const session = new SimSession(1234);
    expect(
      bestOf(3, () => {
        for (let i = 0; i < 120; i++) session.frame(1 / 60);
      }),
    ).toBeLessThan(120);
  });
});

describe('driven frames', () => {
  it('steps 120 driven frames in under 120 ms', () => {
    const session = new SimSession(SEED);
    const home = session.spider.capture();
    expect(
      bestOf(
        3,
        () => stepDriven(session),
        () => session.spider.settle(home),
      ),
    ).toBeLessThan(120);

    session.spider.settle(home);
    stepDriven(session);
    const moved = Math.hypot(
      session.spider.root.position.x - home.position.x,
      session.spider.root.position.z - home.position.z,
    );
    expect(moved).toBeGreaterThan(1);
    expect(session.spider.halt).toBe('clear');
  });
});

describe('route around the nest', () => {
  it('routes around the nest in under 15 ms', () => {
    const world = createWorld(SEED);
    const height = (x: number, z: number): number => surfaceOf(world.terrain, x, z);
    const blocks = world.blocks.filter((block) => block.id.startsWith('nest-ring-'));
    const plan = planAroundNest(blocks, height);
    expect(plan !== null && plan.direct === false && plan.points.length > 2).toBe(true);
    expect(bestOf(5, () => void planAroundNest(blocks, height))).toBeLessThan(15);
  });
});

describe('worker boot', () => {
  it('bakes a worker island in under 250 ms', () => {
    expect(bestOf(3, () => void bakeWorkerIsland())).toBeLessThan(250);
  });
});

describe('main-thread dress', () => {
  it('dresses the island on the main thread in under 250 ms', async () => {
    const world = createWorld(SEED);
    const prepared = await bakeWorkerIsland();
    expect(world.entities.some((entity) => entity.kind === 'nest')).toBe(true);
    expect(world.entities.some((entity) => entity.kind === 'apple')).toBe(true);
    expect(world.entities.some((entity) => entity.kind === 'grass')).toBe(true);
    expect(
      bestOf(3, () => {
        islandGroup(prepared.island);
        dressIsland(world);
      }),
    ).toBeLessThan(250);
  });
});

describe('observe budgets', () => {
  const seed = 12345;
  const terrain = new Terrain(seed);
  const world = createWorld(seed, terrain);
  const height = (x: number, z: number): number => terrain.height(x, z);
  const eye = surfaceOf(terrain, 0, 0) + EYE_HEIGHT;
  const state = {
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

  it('traces a full sight outline in under 15 ms', () => {
    expect(
      bestOf(5, () => void sightOutline(0, 0, eye, VIEW_DISTANCE, height, world.blocks)),
    ).toBeLessThan(15);
  });

  it('observes the whole island in under 15 ms', () => {
    expect(
      bestOf(5, () => void toObservation(state, world, REACH, VIEW_DISTANCE, REACH_Y)),
    ).toBeLessThan(15);
  });

  it('refreshes the sight area in under 25 ms', () => {
    expect(
      bestOf(5, () => {
        toObservation(state, world, REACH, VIEW_DISTANCE, REACH_Y);
        sightOutline(0, 0, eye, VIEW_DISTANCE, height, world.blocks);
      }),
    ).toBeLessThan(25);
  });
});

describe('persistence budgets', () => {
  it('captures a body in under 10 ms', () => {
    const idle = new SimSession(7);
    expect(bestOf(5, () => void captureBody(idle, { text: '去巢边', tool: 'walk' }))).toBeLessThan(
      10,
    );
  });

  it('serializes and validates a snapshot in under 10 ms', () => {
    expect(bestOf(5, () => void JSON.stringify(record))).toBeLessThan(10);
    expect(bestOf(5, () => void classify(wire, record.day))).toBeLessThan(10);
  });

  it('keeps the wire under the stored size limit', () => {
    expect(wire.length).toBeLessThan(MAX_JSON);
  });

  it('restores a body in under 60 ms', () => {
    const target = new SimSession(1);
    expect(bestOf(3, () => applyBody(target, record))).toBeLessThan(60);
  });
});

describe('journal budgets', () => {
  it('estimates 400 turns in under 25 ms', () => {
    expect(bestOf(5, () => void estimateTokens(day))).toBeLessThan(25);
  });

  it('fits 400 turns in under 25 ms', () => {
    expect(bestOf(5, () => void fit(day, limits))).toBeLessThan(25);
  });

  it('drops the oldest of 400 turns in under 25 ms', () => {
    expect(bestOf(5, () => void dropOldest(day, limits))).toBeLessThan(25);
  });

  it('prints 400 turns in under 25 ms', () => {
    expect(bestOf(5, () => void transcript(day))).toBeLessThan(25);
  });
});
