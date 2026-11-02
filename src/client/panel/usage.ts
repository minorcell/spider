import { localDate, shiftDate } from '../../shared/dates.js';
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

const DONUT = ['#1b1714', '#8e877e', '#c8c1b7', '#5e5750', '#aaa298'] as const;

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
    bindChrome(page, snapshot);
  };

  const bindChrome = (root: HTMLElement, snapshot: UsageSnapshot): void => {
    const rangeButton = root.querySelector<HTMLButtonElement>('.range');
    const rangeMenu = root.querySelector<HTMLElement>('#usage-range-menu');
    const exportButton = root.querySelector<HTMLButtonElement>('#usage-export');
    const setOpen = (open: boolean): void => {
      rangeButton?.setAttribute('aria-expanded', String(open));
      rangeMenu!.hidden = !open;
    };
    rangeButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(rangeButton.getAttribute('aria-expanded') !== 'true');
    });
    rangeMenu?.addEventListener('click', (event) => {
      const option = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        '[role="option"]',
      );
      if (!option) return;
      const next = option.dataset.value;
      if (next === '7' || next === '30' || next === 'all') range = next;
      setOpen(false);
      void refresh();
    });
    exportButton?.addEventListener('click', () => {
      exportSnapshot(snapshot, exportButton);
    });
  };

  const onDocumentClick = (event: MouseEvent): void => {
    /* v8 ignore next */
    if (!(event.target instanceof Node)) return;
    if (!page.querySelector('.select-wrap')?.contains(event.target)) {
      const rangeButton = page.querySelector<HTMLButtonElement>('.range');
      const rangeMenu = page.querySelector<HTMLElement>('#usage-range-menu');
      if (rangeButton) rangeButton.setAttribute('aria-expanded', 'false');
      if (rangeMenu) rangeMenu.hidden = true;
    }
  };
  doc.addEventListener('click', onDocumentClick);

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
    h(
      doc,
      'p',
      { class: 'notice' },
      h(doc, 'b', {}, '统计口径'),
      '输入、输出、缓存和推理 token 来自模型返回；旧记录只有每日汇总，缺失的明细按总量推算。',
    ),
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
  const options = (['7', '30', 'all'] as const).map((value) =>
    h(
      doc,
      'button',
      {
        type: 'button',
        role: 'option',
        'data-value': value,
        'aria-selected': value === range ? 'true' : 'false',
      },
      RANGE_LABEL[value],
    ),
  );
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
      h(
        doc,
        'div',
        { class: 'select-wrap' },
        h(
          doc,
          'button',
          {
            class: 'range',
            type: 'button',
            'data-value': range,
            'aria-haspopup': 'listbox',
            'aria-expanded': 'false',
            'aria-controls': 'usage-range-menu',
          },
          RANGE_LABEL[range],
          h(doc, 'span', { class: 'select-arrow', 'aria-hidden': 'true' }, '⌄'),
        ),
        h(
          doc,
          'div',
          { class: 'select-menu', id: 'usage-range-menu', role: 'listbox', hidden: true },
          ...options,
        ),
      ),
      h(doc, 'button', { class: 'ghost', type: 'button', id: 'usage-export' }, '导出'),
    ),
  );
}

function buildKpis(doc: Document, kpis: UsageKpis, range: UsageRange): HTMLElement {
  const delta = weekDelta(kpis, range);
  const toolFoot =
    kpis.toolNames === 0 && kpis.toolCalls > 0
      ? `${kpis.toolCalls} 次 · 历史记录无工具明细`
      : `${kpis.toolNames} 个工具 · 成功率 ${Math.round(kpis.toolOkRate)}%`;
  return h(
    doc,
    'section',
    { class: 'kpis', 'aria-label': '用量概览' },
    kpi(doc, '模型请求', String(kpis.calls), delta),
    kpi(doc, '工具调用', String(kpis.toolCalls), toolFoot),
    kpi(
      doc,
      '缓存命中',
      [
        doc.createTextNode(String(Math.round(kpis.cacheHitRate))),
        h(doc, 'span', { class: 'kpi-unit' }, '%'),
      ],
      `读 ${formatTokens(kpis.cacheRead)} · 写 ${formatTokens(kpis.cacheWrite)} tokens`,
    ),
    kpi(
      doc,
      '输入 / 输出',
      ratioNodes(doc, kpis.input, kpis.output),
      `输入 ${formatTokens(kpis.input)} · 输出 ${formatTokens(kpis.output)}`,
    ),
  );
}

function kpi(doc: Document, label: string, value: string | Node[], foot: string): HTMLElement {
  const article = h(
    doc,
    'article',
    { class: 'kpi' },
    h(doc, 'span', { class: 'kpi-label' }, label),
  );
  const amount = h(doc, 'div', { class: 'kpi-value' });
  if (typeof value === 'string') amount.textContent = value;
  else amount.append(...value);
  article.append(amount, h(doc, 'span', { class: 'kpi-foot' }, foot));
  return article;
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
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0].map((value) =>
    h(doc, 'span', {}, formatAxis(value)),
  );
  const groups = chart.map((day) => {
    const total = day.total;
    const stackHeight = max === 0 || total === 0 ? 0 : (total / max) * 100;
    const inputShare = total === 0 ? 0 : (day.input / total) * 100;
    const outputShare = total === 0 ? 0 : (day.output / total) * 100;
    const stack = h(doc, 'div', { class: 'bar-stack' });
    stack.style.height = `${stackHeight}%`;
    const inputBar = h(doc, 'i', { class: 'bar input' });
    const outputBar = h(doc, 'i', { class: 'bar output' });
    inputBar.style.height = `${inputShare}%`;
    outputBar.style.height = `${outputShare}%`;
    stack.append(inputBar, outputBar);
    return h(
      doc,
      'div',
      { class: 'bar-group' },
      stack,
      h(doc, 'small', {}, day.date === today ? '今天' : shortDate(day.date)),
    );
  });
  return h(
    doc,
    'article',
    { class: 'card' },
    h(
      doc,
      'div',
      { class: 'card-head' },
      h(doc, 'h2', {}, '每日消耗'),
      h(doc, 'small', {}, `token · ${RANGE_LABEL[range]}`),
    ),
    h(
      doc,
      'div',
      { class: 'chart' },
      h(doc, 'div', { class: 'y-axis' }, ...ticks),
      h(doc, 'div', { class: 'bars', 'aria-label': '每日输入输出 token 柱状图' }, ...groups),
    ),
    h(
      doc,
      'div',
      { class: 'legend' },
      h(doc, 'span', {}, '输入'),
      h(doc, 'span', { class: 'out' }, '输出'),
    ),
  );
}

function buildDonut(doc: Document, snapshot: UsageSnapshot): HTMLElement {
  const parts = compositionOf(snapshot);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const donut = h(doc, 'div', { class: 'donut' });
  donut.style.background = donutFill(parts, total);
  const center = h(
    doc,
    'div',
    { class: 'donut-center' },
    h(doc, 'strong', {}, formatTokens(snapshot.kpis.input + snapshot.kpis.output)),
    h(doc, 'small', {}, '总 token'),
  );
  const rows = parts.map((part) => {
    const width = total === 0 ? 0 : (part.value / total) * 100;
    const fill = h(doc, 'i', { class: `fill ${part.tone}` });
    fill.style.width = `${width}%`;
    return h(
      doc,
      'div',
      { class: 'break-row' },
      h(doc, 'span', { class: 'name' }, part.name),
      h(doc, 'strong', {}, formatTokens(part.value)),
      h(doc, 'div', { class: 'track' }, fill),
    );
  });
  return h(
    doc,
    'article',
    { class: 'card' },
    h(
      doc,
      'div',
      { class: 'card-head' },
      h(doc, 'h2', {}, 'Token 构成'),
      h(
        doc,
        'small',
        {},
        `${formatTokens(snapshot.kpis.input)} 输入 · ${formatTokens(snapshot.kpis.output)} 输出`,
      ),
    ),
    h(
      doc,
      'div',
      { class: 'donut-wrap' },
      donut,
      center,
      h(doc, 'div', { class: 'breakdown' }, ...rows),
    ),
  );
}

function buildModels(doc: Document, models: UsageModelRow[]): HTMLElement {
  const body =
    models.length === 0
      ? h(doc, 'tr', {}, h(doc, 'td', { colspan: '5' }, '还没有按模型的记录。'))
      : models.map((row, index) => {
          const avg = row.timedCalls === 0 ? undefined : row.responseMs / row.timedCalls;
          return h(
            doc,
            'tr',
            {},
            h(
              doc,
              'td',
              {},
              h(
                doc,
                'span',
                { class: 'model-name' },
                h(doc, 'i', { class: index === 0 ? 'model-dot' : 'model-dot blue' }),
                row.modelId,
              ),
              h(doc, 'span', { class: 'sub' }, row.provider === '' ? '兼容接口' : row.provider),
            ),
            h(doc, 'td', { class: 'num' }, String(row.calls)),
            h(doc, 'td', { class: 'num' }, formatTokens(row.total)),
            h(doc, 'td', { class: 'num' }, formatRatio(row.input, row.output)),
            h(doc, 'td', { class: 'num' }, formatDuration(avg)),
          );
        });
  return tableCard(
    doc,
    '按模型',
    '模型返回的 token 为精确值',
    ['模型', '请求', '总 token', '输入 / 输出', '平均响应'],
    body,
  );
}

function buildTools(doc: Document, tools: UsageToolRow[]): HTMLElement {
  const body =
    tools.length === 0
      ? h(doc, 'tr', {}, h(doc, 'td', { colspan: '5' }, '还没有工具调用。'))
      : tools.map((row) => {
          const rate = (row.ok / row.calls) * 100;
          const avg = row.durationMs / row.calls;
          return h(
            doc,
            'tr',
            {},
            h(doc, 'td', { class: 'tool-name' }, row.name),
            h(doc, 'td', { class: 'num' }, String(row.calls)),
            h(doc, 'td', { class: `num${rate === 100 ? ' ok' : ''}` }, `${Math.round(rate)}%`),
            h(doc, 'td', { class: 'num' }, formatDuration(avg)),
            h(
              doc,
              'td',
              { class: 'num' },
              `${formatTokens(row.inputBytes)} / ${formatTokens(row.outputBytes)} B`,
            ),
          );
        });
  return tableCard(
    doc,
    '按工具',
    '从开始到结束的时间',
    ['工具', '调用', '成功率', '平均耗时', '输入 / 输出'],
    body,
  );
}

function tableCard(
  doc: Document,
  title: string,
  hint: string,
  headers: string[],
  body: HTMLElement | HTMLElement[],
): HTMLElement {
  const head = h(
    doc,
    'tr',
    {},
    ...headers.map((label, index) => h(doc, 'th', { class: index === 0 ? '' : 'num' }, label)),
  );
  const rows = Array.isArray(body) ? body : [body];
  return h(
    doc,
    'section',
    { class: 'card section' },
    h(doc, 'div', { class: 'card-head' }, h(doc, 'h2', {}, title), h(doc, 'small', {}, hint)),
    h(doc, 'table', { class: 'table' }, h(doc, 'thead', {}, head), h(doc, 'tbody', {}, ...rows)),
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
  return h(
    doc,
    'section',
    { class: 'card section' },
    h(doc, 'div', { class: 'card-head' }, h(doc, 'h2', {}, '请求明细'), h(doc, 'small', {}, hint)),
    list,
  );
}

function requestRow(doc: Document, call: UsageCall): HTMLElement {
  const kind = call.kind === 'summary' ? '整理对话' : '任务';
  const finish = finishLabel(call.finishReason);
  const sub = call.tools.length > 0 ? '调用了工具' : finish;
  const details = h(doc, 'details', { class: 'request' });
  const chevron = h(doc, 'span', { class: 'chevron' }, '›');
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
    chevron,
  );
  details.append(summary);
  let filled = false;
  details.addEventListener('toggle', () => {
    if (!details.open || filled) return;
    filled = true;
    details.append(requestDetail(doc, call, finish));
  });
  return details;
}

function requestDetail(doc: Document, call: UsageCall, finish: string): HTMLElement {
  const tools =
    call.tools.length === 0
      ? [
          h(
            doc,
            'span',
            { class: 'pill' },
            call.toolCalls != null && call.toolCalls > 0
              ? `历史 ${call.toolCalls} 次工具调用，无明细`
              : '没有工具调用',
          ),
        ]
      : call.tools.map((tool) =>
          h(
            doc,
            'span',
            { class: 'pill' },
            `${tool.name} · ${formatDuration(tool.durationMs)} · ${tool.ok ? '成功' : '失败'}`,
          ),
        );
  return h(
    doc,
    'div',
    { class: 'request-detail' },
    h(
      doc,
      'div',
      {},
      h(doc, 'strong', {}, '输出'),
      `文本 ${formatTokens(call.output.text)} · 推理 ${formatTokens(call.output.reasoning)}`,
    ),
    h(
      doc,
      'div',
      {},
      h(doc, 'strong', {}, '缓存'),
      `读 ${formatTokens(call.input.cacheRead)} · 写 ${formatTokens(call.input.cacheWrite)}`,
    ),
    h(doc, 'div', {}, h(doc, 'strong', {}, '结束原因'), h(doc, 'span', { class: 'pill' }, finish)),
    h(doc, 'div', { class: 'tool-list' }, ...tools),
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

function donutFill(parts: Array<{ value: number }>, total: number): string {
  if (total === 0) return 'var(--paper-deep, #e9e4da)';
  const stops: string[] = [];
  let start = 0;
  parts.forEach((part, index) => {
    if (part.value <= 0) return;
    const next = start + (part.value / total) * 100;
    stops.push(`${DONUT[index]} ${start}% ${next}%`);
    start = next;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function weekDelta(kpis: UsageKpis, range: UsageRange): string {
  if (kpis.previousCalls == null) return '实际请求';
  const delta = kpis.calls - kpis.previousCalls;
  const sign = delta > 0 ? '+' : '';
  const label = range === '30' ? '较前 30 天' : '较上周';
  return `实际请求 · ${label} ${sign}${delta}`;
}

function exportSnapshot(snapshot: UsageSnapshot, button: HTMLButtonElement): void {
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
  const doc = button.ownerDocument;
  const link = doc.createElement('a');
  link.href = href;
  link.download = 'token-usage-summary.json';
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  button.textContent = '已导出';
  window.setTimeout(() => {
    button.textContent = '导出';
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

function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = String(value);
    else if (key === 'hidden') node.hidden = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}
