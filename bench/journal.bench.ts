import { describe, test } from 'vitest';
import {
  blankSession,
  estimateTokens,
  fit,
  transcript,
  type ChatSession,
  type CompactLimits,
} from '../src/client/journal/session.js';

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
const session = longDay(400);

describe('journal', () => {
  test('estimate 400 turns', async ({ bench }) => {
    await bench('estimate 400 turns', () => {
      estimateTokens(session);
    }).run();
  });

  test('fit 400 turns', async ({ bench }) => {
    await bench('fit 400 turns', () => {
      fit(session, limits);
    }).run();
  });

  test('transcript 400 turns', async ({ bench }) => {
    await bench('transcript 400 turns', () => {
      transcript(session);
    }).run();
  });
});
