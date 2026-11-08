import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpiderDb } from '@/src/client/storage/db';
import { Diary } from '@/src/client/journal/diary';
import { localDate } from '@/src/shared/dates';
import { createHandler } from '@/src/client/worker/handler';
import type { JournalState } from '@/src/client/worker/protocol';
import type { PilotSettings } from '@/src/client/settings';
import { createDbRepository } from '@/src/client/storage/direct';
import type { PersistenceRepository } from '@/src/client/storage/repository';
let repository: PersistenceRepository;

vi.mock('@/src/client/journal/summarize', () => ({
  summarizeDiary: vi.fn(async () => ({ line: '记下了', summary: '摘要' })),
}));

const SETTINGS: PilotSettings = {
  provider: 'custom',
  baseURL: 'https://example.com',
  model: 'model-1',
  apiKey: 'key',
  contextTokens: null,
  autoMemory: false,
  thinking: true,
};

beforeEach(async () => {
  await resetSpiderDb();
  repository = createDbRepository();
});

describe('journal worker handler', () => {
  it('opens the diary and returns its cloneable state', async () => {
    const handle = createHandler(repository);
    const state = (await handle({ id: 1, method: 'open' })) as JournalState;
    expect(state.date).toBe(localDate(new Date()));
    expect(state.session.messages).toEqual([]);
    expect(state.behind).toBe(false);
    expect(state.dismissed).toBe(false);
    expect(await handle({ id: 2, method: 'open' })).toEqual(state);
  });

  it('records a turn and saves it', async () => {
    const handle = createHandler(repository);
    const state = (await handle({
      id: 1,
      method: 'record',
      args: [
        [
          { role: 'user', content: '走' },
          { role: 'assistant', content: '好。' },
        ],
        SETTINGS,
      ],
    })) as JournalState;
    expect(state.session.messages).toHaveLength(2);
    expect(await handle({ id: 2, method: 'pages' })).toEqual([]);
    await handle({ id: 3, method: 'save' });
    const reopened = await Diary.open(new Date());
    expect(reopened.session.messages).toHaveLength(2);
  });

  it('reads and writes diary pages through the same handle', async () => {
    const handle = createHandler(repository);
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
  });

  it('digests today and backfills yesterday', async () => {
    const handle = createHandler(repository);
    await handle({
      id: 1,
      method: 'record',
      args: [
        [
          { role: 'user', content: '走' },
          { role: 'assistant', content: '好。' },
        ],
        SETTINGS,
      ],
    });
    const state = (await handle({ id: 2, method: 'digest', args: [SETTINGS] })) as JournalState;
    expect(state.behind).toBe(false);
    expect(
      (await handle({ id: 3, method: 'read', args: [state.date] })) as { line: string },
    ).toMatchObject({ line: '记下了' });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const day = await Diary.open(yesterday);
    await day.record(
      [
        { role: 'user', content: '昨天' },
        { role: 'assistant', content: '在。' },
      ],
      SETTINGS,
    );
    await handle({ id: 4, method: 'backfill', args: [SETTINGS] });
    expect(await handle({ id: 5, method: 'read', args: [day.date] })).toMatchObject({
      line: '记下了',
    });
  });

  it('dismisses the leave dialog', async () => {
    const state = await createHandler(repository)({ id: 1, method: 'dismiss', args: [true] });
    expect(state).toMatchObject({ dismissed: true });
  });

  it('keeps concurrent diary writes in arrival order', async () => {
    const handle = createHandler(repository);
    const date = localDate(new Date());
    const writing = handle({ id: 1, method: 'write', args: [{ date, line: 'first' }] });
    const reading = handle({ id: 2, method: 'read', args: [date] });
    await writing;
    expect(await reading).toMatchObject({ line: 'first' });
  });

  it('advances the queue after a failed request', async () => {
    const handle = createHandler(repository);
    await expect(handle({ id: 1, method: 'record', args: undefined } as never)).rejects.toThrow();
    expect(await handle({ id: 2, method: 'open' })).toMatchObject({
      date: localDate(new Date()),
    });
  });
});
