import { localDate, shiftDate } from '../../shared/dates.js';
import { dressUsage } from '../../ui/dress.js';
import { button } from '../../ui/button/index.js';
import { card } from '../../ui/card/index.js';
import { donutChart, stackedBarChart } from '../../ui/chart/index.js';
import { disclosure } from '../../ui/disclosure/index.js';
import { h } from '../../ui/dom/index.js';
import { facts } from '../../ui/facts/index.js';
import { kpi, kpiGrid } from '../../ui/kpi/index.js';
import { notice } from '../../ui/notice/index.js';
import { pill } from '../../ui/pill/index.js';
import { menuSelect, type MenuSelect } from '../../ui/select/index.js';
import { table, type TableCell } from '../../ui/table/index.js';
import type { Journal } from '../journal/api.js';
import { formatTokens } from '../journal/tokens.js';
import {
  blankUsage,
  type UsageCall,
  type UsageDay,
  type UsageKpis,
  type UsageModelRow,
  type UsageRange,
  type UsageSnapshot,
  type UsageToolRow,
} from '../journal/usage.js';

const RANGE_LABEL: Record<UsageRange, string> = {
  '7': '最近 7 天',
  '30': '最近 30 天',
  all: '全部时间',
};

const FINISH_LABEL: Record<string, string> = {
  stop: '完成',
  'tool-calls': '调用工具',
  length: '长度限制',
  error: '错误',
  other: '其他',
  'content-filter': '内容过滤',
};

export function bindUsage(opts: {
  doc: Document;
  menuUsage: HTMLButtonElement;
  usagePanel: HTMLElement;
  showPage: () => void;
  getJournal: () => Journal | null;
  journalReady: Promise<Journal | null>;
}): { refresh: () => Promise<void> } {
  const { doc, menuUsage, usagePanel, showPage, getJournal, journalReady } = opts;
  let range: UsageRange = '7';
  const page = doc.createElement('div');
  page.className = 'usage-page';
  usagePanel.replaceChildren(page);

  const emptyOf = (today: string): UsageSnapshot => {
    const span = range === '7' ? 7 : range === '30' ? 30 : 1;
    const chart: UsageDay[] = [];
    for (let i = span - 1; i >= 0; i--) chart.push(blankUsage(shiftDate(today, -i)));
    const sum = blankUsage('');
    return {
      today: blankUsage(today),
      sum,
      days: [],
      range,
      chart,
      kpis: {
        calls: 0,
        toolCalls: 0,
        toolNames: 0,
        toolOkRate: 0,
        cacheHitRate: 0,
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        text: 0,
        reasoning: 0,
        previousCalls: range === 'all' ? null : 0,
      },
      models: [],
      tools: [],
      requests: [],
      requestTotal: 0,
    };
  };

  const render = (snapshot: UsageSnapshot): void => {
    page.replaceChildren(buildPage(doc, snapshot, range));
    dressUsage(page);
    bindChrome(page, snapshot);
  };

  const bindChrome = (root: HTMLElement, snapshot: UsageSnapshot): void => {
    const rangeInput = root.querySelector<MenuSelect>('input[name="usage-range"]')!;
    rangeInput.addEventListener('change', () => {
      const next = rangeInput.value;
      if (next === '7' || next === '30' || next === 'all') range = next;
      void refresh();
    });
    const exportButton = root.querySelector<HTMLButtonElement>('#usage-export')!;
    exportButton.addEventListener('click', () => {
      exportSnapshot(snapshot, exportButton);
    });
  };

  const refresh = async (): Promise<void> => {
    const today = localDate(new Date());
    const opened = getJournal() ?? (await journalReady);
    try {
      if (!opened) throw new Error('no journal');
      render(await opened.readUsage(today, range));
    } catch {
      render(emptyOf(today));
    }
  };

  menuUsage.addEventListener('click', () => {
    showPage();
    void refresh();
  });

  return { refresh };
}

function buildPage(doc: Document, snapshot: UsageSnapshot, range: UsageRange): HTMLElement {
  const today = snapshot.today.date;
  const root = h(doc, 'div', {});
  root.append(
    buildTop(doc, range),
    notice(doc, {
      label: '统计口径',
      text: '输入、输出、缓存和推理 token 来自模型返回；旧记录只有每日汇总，缺失的明细按总量推算。',
    }),
    buildKpis(doc, snapshot.kpis, range),
    buildGrid(doc, snapshot, today, range),
    buildModels(doc, snapshot.models),
    buildTools(doc, snapshot.tools),
    buildRequests(doc, snapshot.requests, snapshot.requestTotal),
    h(
      doc,
      'p',
      { class: 'footer-note' },
      range === 'all'
        ? '完整对话内容、访问密钥和工具参数不会放进统计页。'
        : `仅显示${RANGE_LABEL[range]}。完整对话内容、访问密钥和工具参数不会放进统计页。`,
    ),
  );
  return root;
}

function buildTop(doc: Document, range: UsageRange): HTMLElement {
  return h(
    doc,
    'header',
    { class: 'top' },
    h(
      doc,
      'div',
      {},
      h(doc, 'p', { class: 'eyebrow' }, '设置 / 用量'),
      h(doc, 'h1', {}, 'Token 用量'),
    ),
    h(
      doc,
      'div',
      { class: 'top-actions' },
      menuSelect(doc, {
        name: 'usage-range',
        menuId: 'usage-range-menu',
        buttonClass: 'range',
        value: range,
        choices: (['7', '30', 'all'] as const).map((value) => ({
          value,
          label: RANGE_LABEL[value],
        })),
      }),
      button(doc, '导出', { variant: 'ghost', id: 'usage-export' }),
    ),
  );
}

function buildKpis(doc: Document, kpis: UsageKpis, range: UsageRange): HTMLElement {
  const delta = weekDelta(kpis, range);
  const toolFoot =
    kpis.toolNames === 0 && kpis.toolCalls > 0
      ? `${kpis.toolCalls} 次 · 历史记录无工具明细`
      : `${kpis.toolNames} 个工具 · 成功率 ${Math.round(kpis.toolOkRate)}%`;
  return kpiGrid(
    doc,
    { label: '用量概览' },
    kpi(doc, { label: '模型请求', value: String(kpis.calls), foot: delta }),
    kpi(doc, { label: '工具调用', value: String(kpis.toolCalls), foot: toolFoot }),
    kpi(doc, {
      label: '缓存命中',
      value: [
        doc.createTextNode(String(Math.round(kpis.cacheHitRate))),
        h(doc, 'span', { class: 'kpi-unit' }, '%'),
      ],
      foot: `读 ${formatTokens(kpis.cacheRead)} · 写 ${formatTokens(kpis.cacheWrite)} tokens`,
    }),
    kpi(doc, {
      label: '输入 / 输出',
      value: ratioNodes(doc, kpis.input, kpis.output),
      foot: `输入 ${formatTokens(kpis.input)} · 输出 ${formatTokens(kpis.output)}`,
    }),
  );
}

function ratioNodes(doc: Document, input: number, output: number): Node[] {
  const text = formatRatio(input, output);
  if (text === '—') return [doc.createTextNode('—')];
  const [left, right] = text.split(' : ');
  return [doc.createTextNode(left), h(doc, 'span', { class: 'kpi-unit' }, ` : ${right}`)];
}

function buildGrid(
  doc: Document,
  snapshot: UsageSnapshot,
  today: string,
  range: UsageRange,
): HTMLElement {
  return h(
    doc,
    'div',
    { class: 'grid' },
    buildChart(doc, snapshot.chart, today, range),
    buildDonut(doc, snapshot),
  );
}

function buildChart(
  doc: Document,
  chart: UsageDay[],
  today: string,
  range: UsageRange,
): HTMLElement {
  const max = niceMax(Math.max(0, ...chart.map((day) => day.total)));
  return stackedBarChart(doc, {
    title: '每日消耗',
    hint: `token · ${RANGE_LABEL[range]}`,
    ariaLabel: '每日输入输出 token 柱状图',
    ticks: [max, max * 0.75, max * 0.5, max * 0.25, 0].map((value) => formatAxis(value)),
    bars: chart.map((day) => ({
      label: day.date === today ? '今天' : shortDate(day.date),
      height: max === 0 || day.total === 0 ? 0 : (day.total / max) * 100,
      input: day.total === 0 ? 0 : (day.input / day.total) * 100,
      output: day.total === 0 ? 0 : (day.output / day.total) * 100,
    })),
  });
}

function buildDonut(doc: Document, snapshot: UsageSnapshot): HTMLElement {
  const parts = compositionOf(snapshot);
  return donutChart(doc, {
    title: 'Token 构成',
    hint: `${formatTokens(snapshot.kpis.input)} 输入 · ${formatTokens(snapshot.kpis.output)} 输出`,
    center: formatTokens(snapshot.kpis.input + snapshot.kpis.output),
    caption: '总 token',
    parts: parts.map((part) => ({
      name: part.name,
      value: formatTokens(part.value),
      amount: part.value,
      tone: part.tone,
    })),
  });
}

function buildModels(doc: Document, models: UsageModelRow[]): HTMLElement {
  const rows = models.map((row, index): TableCell[] => {
    const avg = row.timedCalls === 0 ? undefined : row.responseMs / row.timedCalls;
    const name = doc.createDocumentFragment();
    name.append(
      h(
        doc,
        'span',
        { class: 'model-name' },
        h(doc, 'i', { class: index === 0 ? 'model-dot' : 'model-dot blue' }),
        row.modelId,
      ),
      h(doc, 'span', { class: 'sub' }, row.provider === '' ? '兼容接口' : row.provider),
    );
    return [
      name,
      String(row.calls),
      formatTokens(row.total),
      formatRatio(row.input, row.output),
      formatDuration(avg),
    ];
  });
  return tableCard(
    doc,
    '按模型',
    '模型返回的 token 为精确值',
    ['模型', '请求', '总 token', '输入 / 输出', '平均响应'],
    rows,
    '还没有按模型的记录。',
  );
}

function buildTools(doc: Document, tools: UsageToolRow[]): HTMLElement {
  const rows = tools.map((row): TableCell[] => {
    const rate = (row.ok / row.calls) * 100;
    const avg = row.durationMs / row.calls;
    return [
      h(doc, 'span', { class: 'tool-name' }, row.name),
      String(row.calls),
      `${Math.round(rate)}%`,
      formatDuration(avg),
      `${formatTokens(row.inputBytes)} / ${formatTokens(row.outputBytes)} B`,
    ];
  });
  return tableCard(
    doc,
    '按工具',
    '从开始到结束的时间',
    ['工具', '调用', '成功率', '平均耗时', '输入 / 输出'],
    rows,
    '还没有工具调用。',
  );
}

function tableCard(
  doc: Document,
  title: string,
  hint: string,
  headers: string[],
  rows: TableCell[][],
  empty: string,
): HTMLElement {
  return card(
    doc,
    { title, hint, spaced: true },
    table(doc, {
      columns: headers.map((label, index) => ({ label, numeric: index > 0 })),
      rows,
      empty,
    }),
  );
}

function buildRequests(doc: Document, requests: UsageCall[], total: number): HTMLElement {
  const list =
    requests.length === 0
      ? h(doc, 'p', { id: 'usage-empty', class: 'usage-empty' }, '还没有用量。')
      : h(doc, 'div', { class: 'requests' }, ...requests.map((call) => requestRow(doc, call)));
  const hint =
    total > requests.length
      ? `仅显示最近 ${requests.length} 次，共 ${total} 次`
      : '点击展开每次请求和工具';
  return card(doc, { title: '请求明细', hint, spaced: true }, list);
}

function requestRow(doc: Document, call: UsageCall): HTMLElement {
  const kind = call.kind === 'summary' ? '整理对话' : '任务';
  const finish = finishLabel(call.finishReason);
  const sub = call.tools.length > 0 ? '调用了工具' : finish;
  const summary = h(doc, 'summary');
  const times =
    call.count != null && call.count > 1 ? `汇总 ${call.count} 次` : `第 ${call.step + 1} 次`;
  summary.append(
    h(doc, 'span', { class: 'step' }, `${shortDate(call.date)} · ${times}`),
    h(
      doc,
      'span',
      { class: 'request-model' },
      call.modelId || '未知模型',
      h(doc, 'small', {}, `${kind} · ${sub}`),
    ),
    h(
      doc,
      'span',
      { class: 'request-tokens' },
      formatTokens(call.total),
      h(doc, 'small', {}, `输入 ${formatTokens(call.input.total)}`),
    ),
    h(
      doc,
      'span',
      { class: 'request-time' },
      formatDuration(call.timing.stepMs ?? call.timing.responseMs),
      h(
        doc,
        'small',
        {},
        call.timing.ttftMs == null ? '—' : `首字响应 ${formatDuration(call.timing.ttftMs)}`,
      ),
    ),
  );
  return disclosure(doc, {
    className: 'request',
    summary,
    render: () => requestDetail(doc, call, finish),
  });
}

function requestDetail(doc: Document, call: UsageCall, finish: string): HTMLElement {
  const tools =
    call.tools.length === 0
      ? [
          pill(
            doc,
            call.toolCalls != null && call.toolCalls > 0
              ? `历史 ${call.toolCalls} 次工具调用，无明细`
              : '没有工具调用',
          ),
        ]
      : call.tools.map((tool) =>
          pill(
            doc,
            `${tool.name || '未命名工具'} · ${tool.ok ? '成功' : '失败'} · ${formatDuration(tool.durationMs)} · 入 ${tool.inputBytes} B · 出 ${tool.outputBytes} B · ${tool.id || '无 id'}`,
          ),
        );
  return facts(
    doc,
    { className: 'request-detail', inset: true },
    [
      {
        label: '类型',
        value: `${call.kind === 'summary' ? '整理对话' : '任务'} · 第 ${call.step + 1} 步 · 合并 ${call.count ?? 1} 次`,
      },
      { label: '模型', value: `${call.modelId || '未知模型'} · ${call.provider || '兼容接口'}` },
      { label: '时间', value: `${call.date} ${formatTime(call.ts)}` },
      {
        label: '输入',
        value: `总 ${call.input.total} · 新增 ${call.input.noCache} · 缓存读 ${call.input.cacheRead} · 缓存写 ${call.input.cacheWrite}`,
      },
      {
        label: '输出',
        value: `总 ${call.output.total} · 文本 ${call.output.text} · 推理 ${call.output.reasoning}`,
      },
      { label: '合计 token', value: String(call.total) },
      { label: '首字响应', value: formatDuration(call.timing.ttftMs) },
      { label: '总响应', value: formatDuration(call.timing.responseMs) },
      { label: '单步耗时', value: formatDuration(call.timing.stepMs) },
      { label: '结束原因', value: pill(doc, finish) },
      { label: '会话 / 回合', value: `${call.sessionId} / ${call.turnId}` },
      { label: '记录 id', value: call.id },
    ],
    ...tools,
  );
}

function compositionOf(
  snapshot: UsageSnapshot,
): Array<{ name: string; value: number; tone: string }> {
  const kpis = snapshot.kpis;
  return [
    {
      name: '新输入',
      value: Math.max(0, kpis.input - kpis.cacheRead - kpis.cacheWrite),
      tone: '',
    },
    { name: '缓存读取', value: kpis.cacheRead, tone: 'cache' },
    { name: '缓存写入', value: kpis.cacheWrite, tone: 'write' },
    { name: '文本输出', value: kpis.text, tone: 'text' },
    { name: '推理输出', value: kpis.reasoning, tone: 'reason' },
  ];
}

function weekDelta(kpis: UsageKpis, range: UsageRange): string {
  if (kpis.previousCalls == null) return '实际请求';
  const delta = kpis.calls - kpis.previousCalls;
  const sign = delta > 0 ? '+' : '';
  const label = range === '30' ? '较前 30 天' : '较上周';
  return `实际请求 · ${label} ${sign}${delta}`;
}

function exportSnapshot(snapshot: UsageSnapshot, trigger: HTMLButtonElement): void {
  const payload = {
    range: snapshot.range,
    requests: snapshot.kpis.calls,
    toolCalls: snapshot.kpis.toolCalls,
    totalTokens: snapshot.sum.total,
    cacheHitRate: snapshot.kpis.cacheHitRate / 100,
    models: snapshot.models.map((row) => ({
      modelId: row.modelId,
      calls: row.calls,
      total: row.total,
    })),
    tools: snapshot.tools.map((row) => ({
      name: row.name,
      calls: row.calls,
      ok: row.ok,
    })),
    note: '模型返回的 token 为精确值，旧记录的明细按总量推算。',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const doc = trigger.ownerDocument;
  const link = doc.createElement('a');
  link.href = href;
  link.download = 'token-usage-summary.json';
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  trigger.textContent = '已导出';
  window.setTimeout(() => {
    trigger.textContent = '导出';
  }, 1400);
}

function finishLabel(reason: string): string {
  if (!reason) return '完成';
  return FINISH_LABEL[reason] ?? reason;
}

function shortDate(date: string): string {
  const parts = date.split('-');
  return `${Number(parts[1])}/${parts[2]}`;
}

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = Math.ceil(value / pow);
  return n * pow;
}

function formatAxis(value: number): string {
  if (value === 0) return '0';
  return formatTokens(value);
}

function formatRatio(input: number, output: number): string {
  if (output === 0) return '—';
  return `${(Math.round((input / output) * 10) / 10).toFixed(1)} : 1`;
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds.toFixed(1)}s`;
}

function formatTime(ts: number): string {
  const at = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
