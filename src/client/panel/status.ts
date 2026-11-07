import { button } from '../../ui/button/index.js';
import { h } from '../../ui/dom/index.js';
import { facts } from '../../ui/facts/index.js';
import { paint } from '../../ui/style.js';
import { color } from '../../ui/token.js';
import type { Journal } from '../journal/api.js';
import { COMPACT_AT, estimateTokens } from '../journal/session.js';
import { contextBudgetOf, modelIdOf, pilotReady, readPilot } from '../settings.js';

export function bindStatus(opts: {
  doc: Document;
  menu: HTMLButtonElement;
  panel: HTMLElement;
  dialog: HTMLDialogElement;
  showPage(): void;
  getJournal(): Journal | null;
  journalReady: Promise<Journal | null>;
  isBusy(): boolean;
  modelStatus(): string;
  onReset(): void;
}): void {
  const { doc, menu, panel, dialog, getJournal, journalReady } = opts;
  const labels = {
    model: '当前模型',
    mode: '运行方式',
    state: '模型状态',
    date: '会话日期',
    turns: '当前对话',
    tools: '工具记录',
    tokens: '上下文估算',
    budget: '上下文预算',
    updated: '最近更新',
  };
  const values = Object.fromEntries(
    Object.keys(labels).map((name) => [name, h(doc, 'span', { id: `session-${name}` }, '—')]),
  );
  const title = h(doc, 'h1', {}, '状态');
  paint(title, { margin: '0 0 22px', fontWeight: '400', fontSize: 'clamp(25px, 3vw, 32px)' });
  const details = facts(
    doc,
    {},
    Object.entries(labels).map(([name, label]) => ({ label, value: values[name] })),
  );
  paint(details, { padding: '0' });
  const meter = h(doc, 'progress', { max: '1', value: '0', 'aria-label': '上下文占用' });
  paint(meter, { width: '100%', marginTop: '24px', accentColor: color.ink });
  const budgetHint = h(doc, 'p', { id: 'session-budget-hint' });
  paint(budgetHint, { color: color.muted, fontSize: '12px', margin: '8px 0 24px' });
  const summary = h(doc, 'p', { id: 'session-summary' });
  paint(summary, {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    maxHeight: '200px',
    overflow: 'auto',
  });
  const reset = button(doc, '新建会话', { id: 'session-new', type: 'button' });
  const message = h(doc, 'p', { id: 'session-status', role: 'status' });
  const hint = h(doc, 'p', {}, '开始一段新对话，清空当前对话与压缩摘要。日记和岛上的进度会保留。');
  paint(hint, { color: color.muted, fontSize: '12px' });
  panel.append(
    title,
    details,
    meter,
    budgetHint,
    h(doc, 'h2', {}, '压缩摘要'),
    summary,
    reset,
    hint,
    message,
  );
  paint(panel, { padding: '30px clamp(22px, 4vw, 48px) 36px' });
  let resetting = false;
  const number = (value: number): string => value.toLocaleString('en-US');
  const refresh = (): void => {
    const opened = getJournal();
    const settings = readPilot();
    const session = opened?.session;
    const budget = contextBudgetOf(settings);
    const tokens = session ? estimateTokens(session) : 0;
    values.model.textContent = modelIdOf(settings) || '未设置';
    values.mode.textContent = settings.mode === 'local' ? '本机模型' : '在线模型';
    values.state.textContent =
      settings.mode === 'local' ? opts.modelStatus() : pilotReady(settings) ? '已配置' : '未配置';
    values.date.textContent = session?.date ?? '—';
    values.turns.textContent = `${session?.turns.length ?? 0} 条消息`;
    values.tools.textContent = String(
      session?.turns.reduce((sum, turn) => sum + (turn.tools?.length ?? 0), 0) ?? 0,
    );
    values.tokens.textContent = `${number(tokens)} token`;
    values.budget.textContent = budget == null ? '未设置上限' : `${number(budget)} token`;
    values.updated.textContent = session?.updatedAt
      ? new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })
      : '尚无对话';
    meter.hidden = budget == null;
    meter.value = budget == null ? 0 : Math.min(tokens / budget, 1);
    budgetHint.textContent =
      budget == null
        ? '未设置上下文上限。估算包含当前对话和摘要，不含系统提示词与工具定义。'
        : `达到 80%（${number(Math.floor(budget * COMPACT_AT))} token）时自动压缩。估算不含系统提示词与工具定义。`;
    summary.textContent = session?.summary || '暂无压缩摘要';
    reset.disabled = !opened || resetting || opts.isBusy();
    if (!resetting)
      message.textContent = !opened
        ? '会话暂不可用'
        : opts.isBusy()
          ? '正在处理任务，完成后可新建会话。'
          : '会话空闲';
  };
  reset.addEventListener('click', () => {
    const opened = getJournal();
    if (!opened || resetting || opts.isBusy()) return;
    resetting = true;
    refresh();
    message.textContent = '正在新建会话…';
    void opened
      .resetSession()
      .then(() => {
        opts.onReset();
        message.textContent = '新会话已开始';
      })
      .catch(() => {
        message.textContent = '新建会话失败，请重试';
      })
      .finally(() => {
        resetting = false;
        // Preserve the result while refreshing the counters and button.
        const result = message.textContent;
        refresh();
        message.textContent = result;
      });
  });
  menu.addEventListener('click', () => {
    opts.showPage();
    refresh();
    void journalReady.then(refresh);
  });
  window.setInterval(() => {
    if (dialog.open && !panel.hidden) refresh();
  }, 1000);
  refresh();
}
