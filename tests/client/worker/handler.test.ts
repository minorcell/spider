import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openSpiderDb, resetSpiderDb } from '../../../src/client/journal/db.js';
import { Diary } from '../../../src/client/journal/diary.js';
import { localDate } from '../../../src/shared/dates.js';
import { createHandler } from '../../../src/client/worker/handler.js';
import type { JournalState } from '../../../src/client/worker/protocol.js';
import type { PilotSettings } from '../../../src/client/settings.js';
import { captureBody, type WorldRecord } from '../../../src/shared/sim/snapshot.js';
import { SimSession } from '../../../src/shared/sim/session.js';

vi.mock('../../../src/client/journal/summarize.js', () => ({
  summarizeDiary: vi.fn(async () => ({ line: '记下了', summary: '摘要' })),
}));

const SETTINGS: PilotSettings = {
  baseURL: 'https://example.com',
  model: 'model-1',
  apiKey: 'key',
  contextTokens: null,
  autoMemory: false,
  thinking: true,
};

function record(seq = 1, over: Partial<WorldRecord> = {}): WorldRecord {
  const body = captureBody(new SimSession(5), null);
  return {
    ...body,
    id: 'current',
    format: 3,
    savedAt: Date.now(),
    day: localDate(new Date()),
    owner: 'owner',
    seq,
    leaseUntil: Date.now() + 60_000,
    ...over,
  };
}

beforeEach(async () => {
  await resetSpiderDb();
});

describe('journal worker handler', () => {
  it('opens the diary and returns its cloneable state', async () => {
    const handle = createHandler();
    const state = (await handle({ id: 1, method: 'open' })) as JournalState;
    expect(state.date).toBe(localDate(new Date()));
    expect(state.session.turns).toEqual([]);
    expect(state.behind).toBe(false);
    expect(state.dismissed).toBe(false);
    expect(await handle({ id: 2, method: 'open' })).toEqual(state);
  });

  it('records a turn and saves it', async () => {
    const handle = createHandler();
    const state = (await handle({
      id: 1,
      method: 'record',
      args: ['走', '好。', [], SETTINGS],
    })) as JournalState;
    expect(state.session.turns).toHaveLength(2);
    expect(await handle({ id: 2, method: 'pages' })).toEqual([]);
    await handle({ id: 3, method: 'save' });
    const reopened = await Diary.open(new Date());
    expect(reopened.session.turns).toHaveLength(2);
  });

  it('reads and writes diary pages through the same handle', async () => {
    const handle = createHandler();
    const date = localDate(new Date());
    expect(await handle({ id: 1, method: 'read', args: [date] })).toBeNull();
    const page = await handle({
      id: 2,
      method: 'write',
      args: [{ date, line: '目录句' }],
    });
    expect(page).toMatchObject({ date, line: '目录句' });
    expect(await handle({ id: 3, method: 'pages' })).toHaveLength(1);
    expect(await handle({ id: 4, method: 'pages' })).toEqual([
      expect.objectContaining({ date, description: '目录句' }),
    ]);
    expect(await handle({ id: 5, method: 'indexBlock' })).toContain('目录句');
  });

  it('digests today and backfills yesterday', async () => {
    const handle = createHandler();
    await handle({ id: 1, method: 'record', args: ['走', '好。', [], SETTINGS] });
    const state = (await handle({ id: 2, method: 'digest', args: [SETTINGS] })) as JournalState;
    expect(state.behind).toBe(false);
    expect(
      (await handle({ id: 3, method: 'read', args: [state.date] })) as { line: string },
    ).toMatchObject({ line: '记下了' });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const day = await Diary.open(yesterday);
    await day.record('昨天', '在。', [], SETTINGS);
    await handle({ id: 4, method: 'backfill', args: [SETTINGS] });
    expect(await handle({ id: 5, method: 'read', args: [day.date] })).toMatchObject({
      line: '记下了',
    });
  });

  it('dismisses and records usage', async () => {
    const handle = createHandler();
    const state = (await handle({ id: 1, method: 'dismiss', args: [true] })) as JournalState;
    expect(state.dismissed).toBe(true);
    await handle({
      id: 2,
      method: 'recordUsage',
      args: [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }, Date.now()],
    });
    await handle({
      id: 3,
      method: 'recordUsage',
      args: [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }],
    });
    const usage = (await handle({ id: 4, method: 'readUsage', args: [localDate(new Date())] })) as {
      today: { total: number };
    };
    expect(usage.today.total).toBe(30);
    const date = localDate(new Date());
    await handle({
      id: 5,
      method: 'recordUsageCall',
      args: [
        {
          id: 'c1:0',
          ts: Date.now(),
          date,
          kind: 'agent',
          sessionId: date,
          turnId: 't',
          step: 0,
          provider: 'openai-compatible',
          modelId: 'deepseek-chat',
          total: 4,
          input: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
          output: { total: 2, text: 2, reasoning: 0 },
          tools: [
            { id: 't1', name: 'observe', ok: true, durationMs: 8, inputBytes: 1, outputBytes: 2 },
          ],
          timing: { responseMs: 20, stepMs: 30 },
          finishReason: 'stop',
        },
      ],
    });
    const detailed = (await handle({
      id: 6,
      method: 'readUsage',
      args: [date, '7'],
    })) as { kpis: { calls: number }; requests: unknown[] };
    expect(detailed.kpis.calls).toBeGreaterThanOrEqual(3);
    expect(detailed.requests.length).toBeGreaterThanOrEqual(3);
    await handle({
      id: 7,
      method: 'recordUsageCalls',
      args: [
        [
          {
            id: 'c2:0',
            ts: Date.now(),
            date,
            kind: 'agent',
            sessionId: date,
            turnId: 't',
            step: 1,
            provider: 'openai-compatible',
            modelId: 'deepseek-chat',
            total: 2,
            input: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            output: { total: 1, text: 1, reasoning: 0 },
            tools: [],
            timing: {},
            finishReason: 'stop',
          },
        ],
      ],
    });
    const batched = (await handle({ id: 8, method: 'readUsage', args: [date, '7'] })) as {
      kpis: { calls: number };
    };
    expect(batched.kpis.calls).toBeGreaterThanOrEqual(4);
  });

  it('keeps concurrent requests in arrival order', async () => {
    const handle = createHandler();
    const date = localDate(new Date());
    const writing = handle({
      id: 1,
      method: 'recordUsage',
      args: [{ inputTokens: 2, outputTokens: 3, totalTokens: 5 }],
    });
    const reading = handle({ id: 2, method: 'readUsage', args: [date] });
    await writing;
    expect((await reading) as { today: { total: number } }).toMatchObject({
      today: { total: 5 },
    });
  });

  it('advances the queue after a failed request', async () => {
    const handle = createHandler();
    await expect(handle({ id: 1, method: 'record', args: undefined } as never)).rejects.toThrow();
    expect(await handle({ id: 2, method: 'open' })).toMatchObject({
      date: localDate(new Date()),
    });
  });

  it('keeps snapshots, sweeps junk, and removes the current one', async () => {
    const handle = createHandler();
    const saved = record(2);
    await handle({ id: 1, method: 'snapshotPut', args: [saved] });
    expect(await handle({ id: 2, method: 'snapshotRead' })).toEqual(saved);

    const db = await openSpiderDb();
    await db.put('snapshots', { id: 'old', format: 1 } as unknown as WorldRecord);
    await handle({ id: 3, method: 'snapshotSweep', args: [localDate(new Date())] });
    expect(await db.get('snapshots', 'old')).toBeUndefined();

    await db.put('snapshots', { ...saved, day: '2020-01-01' });
    await handle({ id: 4, method: 'snapshotSweep', args: [localDate(new Date())] });
    expect(await handle({ id: 5, method: 'snapshotRead' })).toEqual({
      ...saved,
      day: '2020-01-01',
    });

    await handle({ id: 6, method: 'snapshotPut', args: [saved] });
    await handle({ id: 7, method: 'snapshotRemove' });
    expect(await handle({ id: 8, method: 'snapshotRead' })).toBeNull();
  });

  it('sweeps old snapshot formats and keeps future ones', async () => {
    const handle = createHandler();
    const db = await openSpiderDb();
    const old = { ...record(), format: 1, day: '2020-01-01' } as unknown as WorldRecord;
    await db.put('snapshots', old);
    await handle({ id: 1, method: 'snapshotSweep', args: [localDate(new Date())] });
    expect(await handle({ id: 2, method: 'snapshotRead' })).toBeNull();

    const future = { id: 'current', format: 4, futureBody: { seed: 7 } } as unknown as WorldRecord;
    await db.put('snapshots', future);
    await handle({ id: 3, method: 'snapshotSweep', args: [localDate(new Date())] });
    expect(await handle({ id: 4, method: 'snapshotRead' })).toEqual(future);

    await db.put('snapshots', { id: 'current', format: 0 } as unknown as WorldRecord);
    await handle({ id: 5, method: 'snapshotSweep', args: [localDate(new Date())] });
    expect(await handle({ id: 6, method: 'snapshotRead' })).toBeNull();
  });
});
