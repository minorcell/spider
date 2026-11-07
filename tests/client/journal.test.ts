import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forceCloseDatabase } from 'fake-indexeddb';
import { openDB, unwrap } from 'idb';
import { openSpiderDb, resetSpiderDb } from '../../src/client/journal/db.js';
import { Diary, onDiaryChange } from '../../src/client/journal/diary.js';
import { localDate, shiftDate } from '../../src/shared/dates.js';
import {
  blankSession,
  dropOldest,
  estimateTokens,
  fit,
  foldSummary,
  needsDigest,
  overLimit,
  toMessages,
  transcript,
  type ChatSession,
} from '../../src/client/journal/session.js';
import { readNote, summarizeDiary } from '../../src/client/journal/summarize.js';
import { readUsage } from '../../src/client/journal/usage.js';
import type { PilotSettings } from '../../src/client/settings.js';

vi.mock('../../src/client/journal/summarize.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/client/journal/summarize.js')>(
    '../../src/client/journal/summarize.js',
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

function session(turns: ChatSession['turns'], summary = ''): ChatSession {
  return { ...blankSession('2026-11-02'), turns, summary, updatedAt: 10 };
}

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

describe('fit', () => {
  it('keeps a short session when no limit is set', () => {
    const chat = session([
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '在。' },
    ]);
    expect(fit(chat, { contextTokens: null })).toEqual({ kind: 'keep' });
    expect(needsDigest(chat)).toBe(true);
    expect(needsDigest({ ...chat, digestedAt: 10 })).toBe(false);
  });

  it('drops tool traces before it drops turns', () => {
    const bulky = 'x'.repeat(800);
    const chat = session([
      { role: 'user', text: '拿' },
      { role: 'assistant', text: '好。', tools: [{ name: 'pick_up', input: {}, output: bulky }] },
      { role: 'user', text: '再拿' },
      { role: 'assistant', text: '好。' },
    ]);
    const action = fit(chat, { contextTokens: estimateTokens(chat) - 10 });
    expect(action.kind).toBe('save');
    if (action.kind !== 'save') return;
    expect(action.session.turns).toHaveLength(4);
    expect(action.session.turns[1]?.tools).toBeUndefined();
  });

  it('asks for a summary once the window is 80% full', () => {
    const chat = session([
      { role: 'user', text: '一'.repeat(80) },
      { role: 'assistant', text: '二'.repeat(80) },
    ]);
    const action = fit(chat, { contextTokens: 20 });
    expect(action.kind).toBe('summarize');
    if (action.kind !== 'summarize') return;
    expect(action.session.turns.at(-1)?.text.startsWith('二')).toBe(true);
  });

  it('folds a summary and keeps the recent tail', () => {
    const turns: ChatSession['turns'] = [];
    for (let i = 0; i < 6; i++) turns.push({ role: i % 2 ? 'assistant' : 'user', text: String(i) });
    const folded = foldSummary(session(turns, '旧'), '新');
    expect(folded.summary).toBe('新');
    expect(folded.turns.map((turn) => turn.text)).toEqual(['2', '3', '4', '5']);
    expect(dropOldest(folded, { contextTokens: 1 }).turns).toHaveLength(1);
  });

  it('compresses at 80% of the context window', () => {
    const chat = session([{ role: 'user', text: 'x'.repeat(400) }]);
    expect(overLimit(chat, { contextTokens: 100 })).toBe(true);
    expect(overLimit(chat, { contextTokens: null })).toBe(false);
    expect(overLimit(chat, { contextTokens: 10_000 })).toBe(false);
  });

  it('keeps the same session when nothing is over the limit', () => {
    const chat = session([{ role: 'user', text: '短' }]);
    expect(dropOldest(chat, { contextTokens: null })).toBe(chat);
  });

  it('writes the transcript and the messages sent to the model', () => {
    const chat = session(
      [
        { role: 'user', text: '拿' },
        {
          role: 'assistant',
          text: '好。',
          tools: [{ name: 'pick_up', input: {}, output: { ok: true } }],
        },
        { role: 'assistant', text: '' },
      ],
      '旧',
    );
    expect(transcript(chat)).toContain('更早：旧');
    expect(transcript(chat)).toContain('行动 pick_up');
    expect(toMessages(chat, '去巢')).toEqual([
      { role: 'user', content: '拿' },
      { role: 'assistant', content: '好。\npick_up {"ok":true}' },
      { role: 'user', content: '去巢' },
    ]);
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
    await today.record('记住不要吃红的', '记下了。', [], settings);
    await today.write({ date: today.date, line: '不要吃红的', noted: '不要吃红的' });
    expect(await today.read(today.date)).toMatchObject({ noted: '不要吃红的' });

    const yesterday = await Diary.open(new Date(2026, 10, 1, 12));
    await yesterday.record(LONG, LONG, [], { ...settings, contextTokens: 1 });
    expect(yesterday.session.summary).toBe('记下了偏好。');

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
    await diary.record('去水边', '到了。', [], settings);
    await diary.digest(settings);
    expect(heard).toHaveBeenCalledTimes(2);
    onDiaryChange(null);
    await diary.write({ date: diary.date, noted: '又记一笔' });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('digests today and then stays quiet', async () => {
    const diary = await Diary.open(new Date(2026, 10, 2, 8));
    expect(await diary.digest(settings)).toBeUndefined();
    await diary.record('去巢里', '到了。', [], settings);
    expect(diary.behind()).toBe(true);
    await diary.digest(settings);
    expect(diary.behind()).toBe(false);
    expect((await diary.read(diary.date))?.line).toBe('主人说不要吃红的');
    diary.dismissed = true;
    await diary.record('再走', '好。', [], settings);
    expect(diary.dismissed).toBe(false);
  });

  it('skips digest without a model', async () => {
    const diary = await Diary.open(new Date(2026, 10, 3, 8));
    await diary.record('你好', '在。', [], settings);
    await diary.digest({ ...settings, apiKey: '' });
    expect(diary.behind()).toBe(true);
    expect(await diary.indexBlock()).toBe('记忆目录是空的。');
  });

  it('leaves an empty session unsaved and reads missing pages as null', async () => {
    const diary = await Diary.open(new Date(2026, 10, 4, 8));
    await diary.save();
    expect(await diary.read('2026-10-01')).toBeNull();
    await diary.write({ date: diary.date, line: '目录一句' });
    await diary.write({ date: diary.date, summary: '摘要' });
    expect(await diary.read(diary.date)).toMatchObject({ line: '目录一句', summary: '摘要' });
  });

  it('lists directory lines and marks empty ones', async () => {
    const diary = await Diary.open(new Date(2026, 10, 5, 8));
    await diary.write({ date: shiftDate(diary.date, -1), line: '昨天说不要吃红的' });
    await diary.write({ date: diary.date, summary: '今天什么都没有' });
    const block = await diary.indexBlock();
    expect(block).toContain('昨天说不要吃红的');
    expect(block).toContain('（无）');
  });

  it('drops tool traces without a summary when that fits the window', async () => {
    const diary = await Diary.open(new Date(2026, 10, 6, 8));
    await diary.record('拿', '好。', [{ name: 'pick_up', input: {}, output: 'x'.repeat(8000) }], {
      ...settings,
      contextTokens: 1,
    });
    expect(diary.session.summary).toBe('');
    expect(diary.session.turns[1]?.tools).toBeUndefined();
    expect(diary.session.turns).toHaveLength(2);
  });

  it('keeps tool traces, then summarizes once the window is 80% full', async () => {
    const diary = await Diary.open(new Date(2026, 10, 6, 8));
    await diary.record(
      '拿',
      '好。',
      [{ name: 'pick_up', input: {}, output: { ok: true } }],
      settings,
    );
    expect(diary.session.turns[1]?.tools).toHaveLength(1);
    await diary.record(LONG, '好。', [], { ...settings, contextTokens: 1 });
    expect(diary.session.summary).toBe('记下了偏好。');
  });

  it('drops the oldest turns when summarizing fails', async () => {
    const diary = await Diary.open(new Date(2026, 10, 7, 8));
    vi.mocked(summarizeDiary).mockRejectedValueOnce(new Error('no model'));
    await diary.record(LONG, LONG, [], { ...settings, contextTokens: 1 });
    expect(diary.session.summary).toBe('');
  });

  it('skips backfill without a model', async () => {
    const diary = await Diary.open(new Date(2026, 10, 8, 8));
    await diary.backfill({ ...settings, apiKey: '' });
    expect(await diary.indexBlock()).toBe('记忆目录是空的。');
  });

  it('keeps existing directory lines when the note is empty', async () => {
    const diary = await Diary.open(new Date(2026, 10, 9, 8));
    await diary.write({ date: diary.date, line: '已有的目录句', summary: '已有的摘要' });
    vi.mocked(summarizeDiary).mockResolvedValueOnce({ line: '', summary: '' });
    await diary.record('走', '好。', [], settings);
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

  it('keeps an earlier summary when the note has none', async () => {
    const diary = await Diary.open(new Date(2026, 10, 11, 8));
    diary.session = {
      ...diary.session,
      summary: '更早的摘要',
      turns: [{ role: 'user', text: '一'.repeat(200) }],
    };
    vi.mocked(summarizeDiary).mockResolvedValueOnce({ line: '新目录句', summary: '' });
    await diary.record(LONG, LONG, [], { ...settings, contextTokens: 1 });
    expect(diary.session.summary).toBe('更早的摘要');
  });

  it('records tokens spent summarizing a day', async () => {
    const diary = await Diary.open(new Date(2026, 10, 12, 8));
    vi.mocked(summarizeDiary).mockResolvedValueOnce({
      line: '目录',
      summary: '摘要',
      usage: {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
        inputTokenDetails: { noCacheTokens: 7, cacheReadTokens: 1, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
      },
    });
    await diary.record(LONG, LONG, [], { ...settings, contextTokens: 1 });
    expect((await readUsage(localDate(new Date()))).today).toMatchObject({
      input: 8,
      output: 2,
      total: 10,
      calls: 1,
      cacheRead: 1,
    });
  });

  it('records tokens spent writing the diary', async () => {
    const diary = await Diary.open(new Date(2026, 10, 13, 8));
    await diary.record('走', '好。', [], settings);
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
    await diary.record(LONG, LONG, [], { ...settings, contextTokens: 1 });
    expect(diary.session.summary).toBe('摘要');
  });
});
