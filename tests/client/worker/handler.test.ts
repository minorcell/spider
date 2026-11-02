import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openSpiderDb, resetSpiderDb } from '../../../src/client/journal/db.js';
import { Diary } from '../../../src/client/journal/diary.js';
import { localDate } from '../../../src/client/journal/dates.js';
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
  compact: false,
  compactKb: null,
  autoMemory: false,
};

function record(seq = 1, over: Partial<WorldRecord> = {}): WorldRecord {
  const body = captureBody(new SimSession(5), null);
  return {
    ...body,
    id: 'current',
    format: 1,
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
    expect(await handle({ id: 2, method: 'state' })).toEqual(state);
  });

  it('records a turn and saves it', async () => {
    const handle = createHandler();
    const state = (await handle({
      id: 1,
      method: 'record',
      args: ['走', '好。', [], SETTINGS],
    })) as JournalState;
    expect(state.session.turns).toHaveLength(2);
    expect(await handle({ id: 2, method: 'listLines' })).toEqual([]);
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
    expect(await handle({ id: 4, method: 'listLines' })).toEqual([{ date, line: '目录句' }]);
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
    expect(await handle({ id: 2, method: 'state' })).toMatchObject({
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
    expect(await handle({ id: 5, method: 'snapshotRead' })).toBeNull();

    await handle({ id: 6, method: 'snapshotPut', args: [saved] });
    await handle({ id: 7, method: 'snapshotRemove' });
    expect(await handle({ id: 8, method: 'snapshotRead' })).toBeNull();
  });
});
