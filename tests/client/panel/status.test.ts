import { beforeEach, expect, it, vi } from 'vitest';
import { bindStatus } from '../../../src/client/panel/status.js';
import { buildChrome } from '../../../src/client/panel/chrome.js';
import { Diary } from '../../../src/client/journal/diary.js';
import { resetSpiderDb } from '../../../src/client/journal/db.js';
import { estimateTokens } from '../../../src/client/journal/session.js';
import {
  flushSettings,
  readPilot,
  resetPilotStore,
  writePilot,
} from '../../../src/client/settings.js';

const text = (id: string): string => document.querySelector(`#session-${id}`)!.textContent!;
const resetButton = (): HTMLButtonElement => document.querySelector('#session-new')!;

beforeEach(async () => {
  await flushSettings().catch(() => undefined);
  resetPilotStore();
  localStorage.clear();
  await resetSpiderDb();
  document.body.replaceChildren(buildChrome(document));
});

function mount(diary: Diary | null, pending = Promise.resolve(diary)) {
  const state = { diary, busy: false, model: '未就绪' };
  const panel = document.querySelector<HTMLElement>('#panel-status')!;
  const dialog = document.querySelector<HTMLDialogElement>('#settings')!;
  const onReset = vi.fn();
  const menu = document.querySelector<HTMLButtonElement>('#menu-status')!;
  bindStatus({
    doc: document,
    panel,
    dialog,
    menu,
    getJournal: () => state.diary,
    journalReady: pending,
    isBusy: () => state.busy,
    modelStatus: () => state.model,
    showPage: () => {
      dialog.open = true;
      panel.hidden = false;
    },
    onReset,
  });
  return { state, panel, dialog, menu, onReset };
}

it('shows an unavailable session and disables reset until the journal opens', async () => {
  const waiting = Promise.withResolvers<Diary | null>();
  const view = mount(null, waiting.promise);
  expect(text('status')).toBe('会话暂不可用');
  expect(text('model')).toBe('未设置');
  expect(text('state')).toBe('未配置');
  expect(text('date')).toBe('—');
  expect(text('turns')).toBe('0 条消息');
  expect(text('tokens')).toBe('0 token');
  expect(resetButton().disabled).toBe(true);
  resetButton().dispatchEvent(new Event('click'));
  expect(view.onReset).not.toHaveBeenCalled();
  view.menu.click();
  view.state.diary = await Diary.open();
  waiting.resolve(view.state.diary);
  await waiting.promise;
  await Promise.resolve();
  expect(resetButton().disabled).toBe(false);
  expect(text('summary')).toBe('暂无压缩摘要');
});

it('shows API session history, tools, summary and the shared context budget', async () => {
  writePilot({
    baseURL: 'https://example.com/v1',
    model: 'online-model',
    apiKey: 'key',
    contextTokens: 16,
  });
  const diary = await Diary.open();
  await diary.record('看一看', '看到了', [{ name: 'observe', input: {}, output: {} }], readPilot());
  diary.session.summary = '更早的对话';
  mount(diary).menu.click();
  expect(text('model')).toBe('online-model');
  expect(text('mode')).toBe('在线模型');
  expect(text('state')).toBe('已配置');
  expect(text('turns')).toBe('2 条消息');
  expect(text('tools')).toBe('1');
  expect(text('tokens')).toBe(`${estimateTokens(diary.session)} token`);
  expect(text('budget')).toBe('16,000 token');
  expect(text('budget-hint')).toContain('12,800 token');
  expect(text('updated')).not.toBe('尚无对话');
  expect(text('summary')).toBe('更早的对话');
  expect(
    document.querySelector<HTMLProgressElement>('#panel-status progress')!.value,
  ).toBeGreaterThan(0);
});

it('uses the 128K local budget and updates task state only while the page is visible', async () => {
  const diary = await Diary.open();
  writePilot({ ...readPilot(), mode: 'local' });
  vi.useFakeTimers();
  const view = mount(diary);
  expect(text('budget')).toBe('131,072 token');
  expect(text('budget-hint')).toContain('104,857 token');
  expect(text('mode')).toBe('本机模型');
  expect(text('state')).toBe('未就绪');
  view.state.busy = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(resetButton().disabled).toBe(false);
  view.dialog.open = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(resetButton().disabled).toBe(false);
  view.menu.click();
  expect(resetButton().disabled).toBe(true);
  resetButton().dispatchEvent(new Event('click'));
  expect(view.onReset).not.toHaveBeenCalled();
  expect(text('status')).toContain('正在处理任务');
  view.state.busy = false;
  view.state.model = '已就绪';
  await vi.advanceTimersByTimeAsync(1000);
  expect(text('state')).toBe('已就绪');
  expect(resetButton().disabled).toBe(false);
});

it('resets once, refreshes counters and preserves memories', async () => {
  const diary = await Diary.open();
  await diary.write({ date: diary.date, noted: '保留的记忆' });
  await diary.record('旧消息', '旧回答', [], readPilot());
  diary.session.summary = '旧摘要';
  const waiting = Promise.withResolvers<void>();
  const original = diary.resetSession.bind(diary);
  const spy = vi.spyOn(diary, 'resetSession').mockImplementation(async () => {
    await waiting.promise;
    await original();
  });
  const view = mount(diary);
  view.menu.click();
  resetButton().click();
  expect(text('status')).toBe('正在新建会话…');
  expect(resetButton().disabled).toBe(true);
  resetButton().dispatchEvent(new Event('click'));
  expect(spy).toHaveBeenCalledOnce();
  waiting.resolve();
  await vi.waitFor(() => expect(text('status')).toBe('新会话已开始'));
  expect(text('turns')).toBe('0 条消息');
  expect(text('summary')).toBe('暂无压缩摘要');
  expect(view.onReset).toHaveBeenCalledOnce();
  expect(resetButton().disabled).toBe(false);
  expect(await diary.read(diary.date)).toMatchObject({ noted: '保留的记忆' });
  expect((await Diary.open()).session.turns).toEqual([]);
});

it('keeps the current session after a reset failure and permits retry', async () => {
  const diary = await Diary.open();
  await diary.record('旧消息', '旧回答', [], readPilot());
  vi.spyOn(diary, 'resetSession').mockRejectedValueOnce(new Error('storage failed'));
  mount(diary).menu.click();
  resetButton().click();
  await vi.waitFor(() => expect(text('status')).toContain('新建会话失败'));
  expect(text('turns')).toBe('2 条消息');
  expect(resetButton().disabled).toBe(false);
  resetButton().click();
  await vi.waitFor(() => expect(text('status')).toBe('新会话已开始'));
});
