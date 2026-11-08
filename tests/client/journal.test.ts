import type { ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forceCloseDatabase } from 'fake-indexeddb';
import { openDB, unwrap } from 'idb';
import { openSpiderDb, resetSpiderDb } from '@/src/client/journal/db';
import { Diary, onDiaryChange } from '@/src/client/journal/diary';
import { localDate, shiftDate } from '@/src/shared/dates';
import {
  blankSession,
  dropOldest,
  estimateTokens,
  needsDigest,
  overLimit,
  restoreSession,
  toolTraces,
  transcript,
  type ChatSession,
} from '@/src/client/journal/session';
import { readNote, summarizeDiary } from '@/src/client/journal/summarize';
import { readUsage } from '@/src/client/journal/usage';
import type { PilotSettings } from '@/src/client/settings';

vi.mock('@/src/client/journal/summarize', async () => {
  const actual = await vi.importActual<typeof import('@/src/client/journal/summarize')>(
    '@/src/client/journal/summarize',
  );
  return {
    ...actual,
    summarizeDiary: vi.fn(async () => ({ line: '主人说不要吃红的', summary: '记下了偏好。' })),
  };
});

const settings: PilotSettings = {
  provider: 'custom',
  baseURL: 'https://example.com',
  model: 'model-1',
  apiKey: 'key',
  contextTokens: null,
  autoMemory: false,
  thinking: true,
};

const LONG = '一'.repeat(1600);

function session(messages: ModelMessage[]): ChatSession {
  return { ...blankSession('2026-11-02'), messages, updatedAt: 10 };
}

function dialogue(user: string, assistant: string): ModelMessage[] {
  return [
    { role: 'user', content: user },
    { role: 'assistant', content: assistant },
  ];
}

const toolMessages: ModelMessage[] = [
  { role: 'user', content: '拿' },
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: '1', toolName: 'act', input: { id: 'apple' } }],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: '1',
        toolName: 'act',
        output: { type: 'json', value: { ok: true } },
      },
    ],
  },
  { role: 'assistant', content: '好。' },
];

beforeEach(async () => {
  await resetSpiderDb();
});

describe('resetSpiderDb', () => {
  it('rejects when the database cannot be deleted', async () => {
    const spy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
      const request = { error: new Error('delete failed') } as unknown as IDBOpenDBRequest;
      setTimeout(() => request.onerror?.(new Event('error')), 0);
      return request;
    });
    await expect(resetSpiderDb()).rejects.toThrow('delete failed');
    spy.mockRestore();
  });

  it('resolves when the delete is blocked', async () => {
    const spy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
      const request = {} as IDBOpenDBRequest;
      setTimeout(() => request.onblocked?.(new Event('blocked')), 0);
      return request;
    });
    await expect(resetSpiderDb()).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('uses a default error when the request has none', async () => {
    const spy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
      const request = {} as IDBOpenDBRequest;
      setTimeout(() => request.onerror?.(new Event('error')), 0);
      return request;
    });
    await expect(resetSpiderDb()).rejects.toThrow('delete failed');
    spy.mockRestore();
  });
});

describe('database connections', () => {
  it('shares one connection while the database is open', async () => {
    const first = openSpiderDb();
    expect(openSpiderDb()).toBe(first);
    await first;
  });

  it('closes a connection that would block a later schema upgrade', async () => {
    const previous = await openSpiderDb();
    const next = await openDB('spider', previous.version + 1);
    expect(next.version).toBe(previous.version + 1);
    next.close();
    await resetSpiderDb();
    const reopened = await openSpiderDb();
    expect(reopened).not.toBe(previous);
  });

  it('opens a fresh connection after an abnormal close', async () => {
    const previous = await openSpiderDb();
    const closed = new Promise<void>((resolve) => {
      previous.addEventListener('close', () => resolve(), { once: true });
    });
    forceCloseDatabase(unwrap(previous));
    await closed;

    const reopened = await openSpiderDb();

    expect(reopened).not.toBe(previous);
    await expect(reopened.get('preferences', 'pilot')).resolves.toBeUndefined();
  });

  it('retries instead of retaining a rejected open request', async () => {
    const newer = await openDB('spider', 8);
    newer.close();
    await expect(openSpiderDb()).rejects.toMatchObject({ name: 'VersionError' });
    await resetSpiderDb();

    await expect(openSpiderDb()).resolves.toMatchObject({ version: 7 });
  });
});

describe('dates', () => {
  it('formats a local day and steps across months', () => {
    expect(localDate(new Date(2026, 10, 2, 23, 30))).toBe('2026-11-02');
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('conversation messages', () => {
  it('keeps messages unchanged when no limit is set', () => {
    const chat = session(toolMessages);
    expect(dropOldest(chat, { contextTokens: null })).toBe(chat);
    expect(needsDigest(chat)).toBe(true);
    expect(needsDigest({ ...chat, digestedAt: 10 })).toBe(false);
    expect(needsDigest(blankSession(chat.date))).toBe(false);
  });

  it('trims complete user turns without separating calls from results', () => {
    const chat = session([...dialogue('x'.repeat(2000), 'old'), ...toolMessages]);
    const trimmed = dropOldest(chat, { contextTokens: 300 });
    expect(trimmed.messages).toEqual(toolMessages);
    expect(chat.messages).toHaveLength(6);
    expect(dropOldest(trimmed, { contextTokens: 1 }).messages).toEqual(toolMessages);
  });

  it('finds the earliest complete turn that fits', () => {
    const chat = session([
      ...dialogue('x'.repeat(4000), 'old'),
      ...dialogue('middle', 'yes'),
      ...toolMessages,
    ]);
    expect(dropOldest(chat, { contextTokens: 400 }).messages).toEqual(chat.messages.slice(2));
    expect(
      dropOldest(session([{ role: 'assistant', content: 'x'.repeat(200) }]), { contextTokens: 1 })
        .messages,
    ).toHaveLength(1);
  });

  it('keeps the newest complete turn even when it alone exceeds the budget', () => {
    const chat = session([
      ...dialogue('x'.repeat(4000), 'old'),
      ...dialogue('y'.repeat(4000), 'middle'),
      ...toolMessages,
    ]);
    expect(dropOldest(chat, { contextTokens: 1 }).messages).toEqual(toolMessages);
  });

  it('compresses at 80% of the context window', () => {
    const chat = session([{ role: 'user', content: 'x'.repeat(400) }]);
    expect(estimateTokens(chat)).toBeGreaterThan(100);
    expect(overLimit(chat, { contextTokens: 100 })).toBe(true);
    expect(overLimit(chat, { contextTokens: null })).toBe(false);
    expect(overLimit(chat, { contextTokens: 10_000 })).toBe(false);
    expect(dropOldest(chat, { contextTokens: 10_000 })).toBe(chat);
  });

  it('derives diagnostic traces and diary text from the same messages', () => {
    const chat = session(toolMessages);
    expect(toolTraces(chat.messages)).toEqual([
      { name: 'act', input: { id: 'apple' }, output: { ok: true } },
    ]);
    expect(transcript(chat)).toContain('调用 act');
    expect(transcript(chat)).toContain('结果 act');
    expect(transcript(chat)).toContain('assistant：好。');
    const denied: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'missing',
            toolName: 'act',
            output: { type: 'execution-denied', reason: 'no' },
          },
        ],
      },
    ];
    expect(toolTraces(denied)[0].output).toMatchObject({ type: 'execution-denied' });
    expect(
      transcript(
        session([{ role: 'assistant', content: [{ type: 'reasoning', text: 'private' }] }]),
      ),
    ).not.toContain('private');
  });

  it('exports SDK text parts to the diary without changing the stored messages', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '看看附近' }] },
      { role: 'assistant', content: [{ type: 'text', text: '看到了。' }] },
    ];
    expect(transcript(session(messages))).toBe('user：看看附近\nassistant：看到了。');
    expect(toolTraces(messages)).toEqual([]);
  });

  it('restores old conversations as linked tool messages once', () => {
    const restored = restoreSession({
      date: '2026-11-02',
      summary: 'old',
      updatedAt: 10,
      digestedAt: 0,
      turns: [
        { role: 'user', text: '拿' },
        {
          role: 'assistant',
          text: '好。',
          tools: [{ name: 'act', input: {}, output: { ok: true } }],
        },
        { role: 'assistant', text: '' },
      ],
    });
    expect(restored.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(toolTraces(restored.messages)).toEqual([
      { name: 'act', input: {}, output: { ok: true } },
    ]);
    expect(restoreSession(restored)).toBe(restored);
  });
});

describe('readNote', () => {
  it('keeps prose when the JSON fields are not strings', () => {
    const text = '{"line":1,"summary":null}';
    expect(readNote(text)).toEqual({ line: text, summary: text });
  });

  it('reads a JSON note and falls back to prose', () => {
    expect(readNote('好的 {"line":"不要吃红的","summary":"主人交代了"}')).toEqual({
      line: '不要吃红的',
      summary: '主人交代了',
    });
    expect(readNote('不是 JSON')).toEqual({ line: '不是 JSON', summary: '不是 JSON' });
    expect(readNote('{')).toEqual({ line: '{', summary: '{' });
  });
});

describe('Diary', () => {
  it('keeps today, writes a note, and backfills yesterday', async () => {
    const today = await Diary.open(new Date(2026, 10, 2, 12));
    await today.record(dialogue('记住不要吃红的', '记下了。'), settings);
    await today.write({ date: today.date, line: '不要吃红的', noted: '不要吃红的' });
    expect(await today.read(today.date)).toMatchObject({ noted: '不要吃红的' });

    const yesterday = await Diary.open(new Date(2026, 10, 1, 12));
    await yesterday.record(dialogue(LONG, LONG), { ...settings, contextTokens: 1 });
    expect(yesterday.session.messages).toEqual(dialogue(LONG, LONG));

    await today.backfill(settings);
    expect((await today.read('2026-11-01'))?.summary).toBe('记下了偏好。');
    await today.backfill(settings);
    expect(await today.api().list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: '2026-11-01' })]),
    );
  });

  it('tells the page when a diary page is written or digested', async () => {
    const heard = vi.fn();
    onDiaryChange(heard);
    const diary = await Diary.open(new Date(2026, 10, 2, 9));
    await diary.write({ date: diary.date, line: '水边' });
    await diary.record(dialogue('去水边', '到了。'), settings);
    await diary.digest(settings);
    expect(heard).toHaveBeenCalledTimes(2);
    onDiaryChange(null);
    await diary.write({ date: diary.date, noted: '又记一笔' });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('digests today and then stays quiet', async () => {
    const diary = await Diary.open(new Date(2026, 10, 2, 8));
    expect(await diary.digest(settings)).toBeUndefined();
    await diary.record(dialogue('去巢里', '到了。'), settings);
    expect(diary.behind()).toBe(true);
    await diary.digest(settings);
    expect(diary.behind()).toBe(false);
    expect((await diary.read(diary.date))?.line).toBe('主人说不要吃红的');
    diary.dismissed = true;
    await diary.record(dialogue('再走', '好。'), settings);
    expect(diary.dismissed).toBe(false);
  });

  it('skips digest without a model', async () => {
    const diary = await Diary.open(new Date(2026, 10, 3, 8));
    await diary.record(dialogue('你好', '在。'), settings);
    await diary.digest({ ...settings, apiKey: '' });
    expect(diary.behind()).toBe(true);
    expect(await diary.api().list()).toEqual([]);
  });

  it('leaves an empty session unsaved and reads missing pages as null', async () => {
    const diary = await Diary.open(new Date(2026, 10, 4, 8));
    await diary.save();
    expect(await diary.read('2026-10-01')).toBeNull();
    await diary.write({ date: diary.date, line: '目录一句' });
    await diary.write({ date: diary.date, summary: '摘要' });
    expect(await diary.read(diary.date)).toMatchObject({ line: '目录一句', summary: '摘要' });
  });

  it('saves and reloads the exact SDK messages, including tool ids and order', async () => {
    const diary = await Diary.open(new Date(2026, 10, 6, 8));
    await diary.record(toolMessages, settings);
    const reopened = await Diary.open(new Date(2026, 10, 6, 9));
    expect(reopened.session.messages).toEqual(toolMessages);
    const next = [...reopened.session.messages, ...dialogue('再走', '好了')];
    await reopened.record(next, settings);
    expect((await Diary.open(new Date(2026, 10, 6, 10))).session.messages).toEqual(next);
  });

  it('bounds the conversation without generating or injecting diary content', async () => {
    const diary = await Diary.open(new Date(2026, 10, 7, 8));
    const summarize = vi.mocked(summarizeDiary);
    const before = summarize.mock.calls.length;
    await diary.record([...dialogue(LONG, LONG), ...toolMessages], {
      ...settings,
      contextTokens: 1,
    });
    expect(diary.session.messages).toEqual(toolMessages);
    expect(summarize.mock.calls.length).toBe(before);
  });

  it('skips backfill without a model', async () => {
    const diary = await Diary.open(new Date(2026, 10, 8, 8));
    await diary.backfill({ ...settings, apiKey: '' });
    expect(await diary.api().list()).toEqual([]);
  });

  it('keeps existing directory lines when the note is empty', async () => {
    const diary = await Diary.open(new Date(2026, 10, 9, 8));
    await diary.write({ date: diary.date, line: '已有的目录句', summary: '已有的摘要' });
    vi.mocked(summarizeDiary).mockResolvedValueOnce({ line: '', summary: '' });
    await diary.record(dialogue('走', '好。'), settings);
    await diary.digest(settings);
    expect(await diary.read(diary.date)).toMatchObject({
      line: '已有的目录句',
      summary: '已有的摘要',
    });
  });

  it('exposes the memory api', async () => {
    const diary = await Diary.open(new Date(2026, 10, 10, 8));
    await diary.write({ date: diary.date, line: '目录句' });
    const api = diary.api();
    expect(await api.list()).toEqual([{ date: diary.date, line: '目录句' }]);
    expect(await api.get(diary.date)).toMatchObject({ line: '目录句' });
    expect(await api.write({ date: diary.date, summary: '摘要' })).toMatchObject({
      summary: '摘要',
    });
  });

  it('migrates old saves and archives their summary only in memory', async () => {
    const date = '2026-11-11';
    const db = await openSpiderDb();
    await db.put('sessions', {
      date,
      summary: '更早的摘要',
      turns: [{ role: 'user', text: '你好' }],
      updatedAt: 1,
      digestedAt: 0,
    } as never);
    const diary = await Diary.open(new Date(2026, 10, 11, 8));
    expect(diary.session.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(await diary.read(date)).toMatchObject({ summary: '更早的摘要' });
    expect(await db.get('sessions', date)).toEqual(diary.session);
    await Diary.open(new Date(2026, 10, 11, 9));
    expect(await diary.read(date)).toMatchObject({ summary: '更早的摘要' });
  });

  it('migrates empty old saves without creating a memory page', async () => {
    const date = '2026-11-15';
    const db = await openSpiderDb();
    await db.put('sessions', {
      date,
      summary: '',
      turns: [{ role: 'assistant', text: '', tools: [{ name: 'act', input: {}, output: null }] }],
      updatedAt: 1,
      digestedAt: 0,
    });
    const diary = await Diary.open(new Date(2026, 10, 15, 8));
    expect(toolTraces(diary.session.messages)[0].output).toBeNull();
    expect(await diary.read(date)).toBeNull();
  });

  it('preserves existing memory content when migrating an old summary', async () => {
    const date = '2026-11-16';
    const db = await openSpiderDb();
    const diary = await Diary.open(new Date(2026, 10, 16, 8));
    await diary.write({ date, summary: '已有日记', noted: '明确记录' });
    await db.put('sessions', { date, summary: '旧摘要', turns: [], updatedAt: 1, digestedAt: 0 });
    const reopened = await Diary.open(new Date(2026, 10, 16, 9));
    expect(await reopened.read(date)).toMatchObject({
      summary: '已有日记\n旧摘要',
      noted: '明确记录',
    });
  });

  it('records tokens spent writing the diary', async () => {
    const diary = await Diary.open(new Date(2026, 10, 13, 8));
    await diary.record(dialogue('走', '好。'), settings);
    vi.mocked(summarizeDiary).mockResolvedValueOnce({
      line: '目录',
      summary: '摘要',
      usage: {
        inputTokens: 4,
        outputTokens: 1,
        totalTokens: 5,
        inputTokenDetails: { noCacheTokens: 4, cacheReadTokens: 0, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
      },
    });
    await diary.digest(settings);
    expect((await readUsage(localDate(new Date()))).today.calls).toBe(1);
  });

  it('keeps the summary when the usage ledger cannot be written', async () => {
    const diary = await Diary.open(new Date(2026, 10, 14, 8));
    const db = await openSpiderDb();
    const original = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation((store, mode, options) => {
      if (Array.isArray(store) ? store.includes('usage') : store === 'usage') {
        throw new Error('usage down');
      }
      return original(store, mode, options);
    });
    vi.mocked(summarizeDiary).mockResolvedValueOnce({
      line: '目录',
      summary: '摘要',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
      },
    });
    await diary.record(dialogue(LONG, LONG), settings);
    await diary.digest(settings);
    expect(await diary.read(diary.date)).toMatchObject({ summary: '摘要' });
  });
});
