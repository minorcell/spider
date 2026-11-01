import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpiderDb } from '../../src/client/journal/db.js';
import { Diary } from '../../src/client/journal/diary.js';
import { localDate, shiftDate } from '../../src/client/journal/dates.js';
import {
  blankSession,
  dropOldest,
  estimateTokens,
  fit,
  foldSummary,
  needsDigest,
  type ChatSession,
} from '../../src/client/journal/session.js';
import { readNote } from '../../src/client/journal/summarize.js';
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
  baseURL: 'https://example.com',
  model: 'model-1',
  apiKey: 'key',
  contextTokens: null,
  compact: false,
  compactKb: null,
};

function session(turns: ChatSession['turns'], summary = ''): ChatSession {
  return { ...blankSession('2026-11-02'), turns, summary, updatedAt: 10 };
}

beforeEach(async () => {
  await resetSpiderDb();
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
    expect(fit(chat, { contextTokens: null, compact: false, compactKb: null })).toEqual({
      kind: 'keep',
    });
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
    const action = fit(chat, {
      contextTokens: estimateTokens(chat) - 10,
      compact: false,
      compactKb: null,
    });
    expect(action.kind).toBe('save');
    if (action.kind !== 'save') return;
    expect(action.session.turns).toHaveLength(4);
    expect(action.session.turns[1]?.tools).toBeUndefined();
  });

  it('drops the oldest turns when compact is off and traces are already gone', () => {
    const chat = session([
      { role: 'user', text: '一'.repeat(40) },
      { role: 'assistant', text: '二'.repeat(40) },
      { role: 'user', text: '三'.repeat(40) },
      { role: 'assistant', text: '四'.repeat(40) },
    ]);
    const action = fit(chat, { contextTokens: 30, compact: false, compactKb: null });
    expect(action.kind).toBe('save');
    if (action.kind !== 'save') return;
    expect(action.session.turns.length).toBeLessThan(chat.turns.length);
    expect(action.session.turns.at(-1)?.text.startsWith('四')).toBe(true);
  });

  it('asks for a summary once automatic compact is on', () => {
    const chat = session([
      { role: 'user', text: '一'.repeat(80) },
      { role: 'assistant', text: '二'.repeat(80) },
    ]);
    const action = fit(chat, { contextTokens: 20, compact: true, compactKb: null });
    expect(action.kind).toBe('summarize');
  });

  it('uses 400 KB when compact is on and the threshold is empty', () => {
    const chat = session([{ role: 'user', text: '短' }]);
    expect(fit(chat, { contextTokens: null, compact: true, compactKb: null })).toEqual({
      kind: 'keep',
    });
  });

  it('folds a summary and keeps the recent tail', () => {
    const turns: ChatSession['turns'] = [];
    for (let i = 0; i < 6; i++) turns.push({ role: i % 2 ? 'assistant' : 'user', text: String(i) });
    const folded = foldSummary(session(turns, '旧'), '新');
    expect(folded.summary).toBe('新');
    expect(folded.turns.map((turn) => turn.text)).toEqual(['2', '3', '4', '5']);
    expect(
      dropOldest(folded, { contextTokens: 1, compact: false, compactKb: null }).turns,
    ).toHaveLength(1);
  });
});

describe('readNote', () => {
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
    await yesterday.record('昨天搬了苹果', '搬了。', [], {
      ...settings,
      compact: true,
      contextTokens: 1,
    });
    expect(yesterday.session.summary).toBe('记下了偏好。');

    await today.backfill(settings);
    expect((await today.read('2026-11-01'))?.summary).toBe('记下了偏好。');
    await today.backfill(settings);
    expect(await today.listLines()).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: '2026-11-01' })]),
    );
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
});
