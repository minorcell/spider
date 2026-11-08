import { describe, test } from 'vitest';
import {
  blankSession,
  planCompaction,
  estimateTokens,
  transcript,
  type ChatSession,
  type CompactLimits,
} from '@/src/client/journal/session';

function longDay(turns: number): ChatSession {
  return {
    ...blankSession('2026-11-02'),
    messages: Array.from({ length: turns }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `这是第 ${index} 轮对话，${'内容'.repeat(20)}`,
    })),
    updatedAt: Date.now(),
  };
}

const limits: CompactLimits = { contextTokens: 4_000 };
const session = longDay(400);

describe('journal', () => {
  test('estimate 400 turns', async ({ bench }) => {
    await bench('estimate 400 turns', () => {
      estimateTokens(session);
    }).run();
  });

  test('plan compaction of 400 turns', async ({ bench }) => {
    await bench('plan compaction of 400 turns', () => {
      planCompaction(session, limits);
    }).run();
  });

  test('transcript 400 turns', async ({ bench }) => {
    await bench('transcript 400 turns', () => {
      transcript(session);
    }).run();
  });
});
