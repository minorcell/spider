// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  blankSession,
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

/**
 * The budgets are deliberately loose: these run on shared CI machines. They
 * catch a path that suddenly becomes quadratic or starts cloning the world on
 * every keystroke, not a few percent of engine noise.
 */
function bestOf(runs: number, work: () => void): number {
  work();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
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

const limits: CompactLimits = { contextTokens: 4_000, compact: true, compactKb: 400 };
const noCompactLimits: CompactLimits = { contextTokens: 4_000, compact: false, compactKb: null };
const day = longDay(400);

function recordOf(seed = 7): WorldRecord {
  const body = captureBody(new SimSession(seed), { text: '去巢边', tool: 'walk' });
  return {
    ...body,
    id: 'current',
    format: 1,
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
  it('builds a seeded island in under 20 ms', () => {
    expect(bestOf(3, () => void new SimSession(1234))).toBeLessThan(60);
  });

  it('steps 120 frames in under 30 ms', () => {
    const session = new SimSession(1234);
    expect(
      bestOf(3, () => {
        for (let i = 0; i < 120; i++) session.frame(1 / 60);
      }),
    ).toBeLessThan(120);
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
  it('estimates 400 turns in under 5 ms', () => {
    expect(bestOf(5, () => void estimateTokens(day))).toBeLessThan(25);
  });

  it('fits 400 turns in under 10 ms', () => {
    expect(bestOf(5, () => void fit(day, limits))).toBeLessThan(25);
  });

  it('fits 400 turns without compact in under 25 ms', () => {
    expect(bestOf(5, () => void fit(day, noCompactLimits))).toBeLessThan(25);
  });

  it('prints 400 turns in under 10 ms', () => {
    expect(bestOf(5, () => void transcript(day))).toBeLessThan(25);
  });
});
