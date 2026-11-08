import { h } from '@/src/ui/dom';
import { paint } from '@/src/ui/style';
import { border, color, font } from '@/src/ui/token';
import { contextTokensOf, type PilotSettings } from '@/src/client/settings';
import type { AgentEvent } from '@/src/client/agent/loop';
import type { Journal } from '@/src/client/journal/api';
import type { Trace } from '@/src/client/journal/session';
import type { SimSession } from '@/src/shared/sim/session';
import { byteSize } from '@/src/client/journal/usage';

const HISTORY_LIMIT = 30;
const REFRESH_MS = 1000;

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '无';
  } catch {
    return '无法显示';
  }
}

function number(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '—';
}

function section(doc: Document, title: string, hint: string): HTMLElement {
  const heading = h(doc, 'h2', {}, title);
  paint(heading, { fontSize: '17px', fontWeight: '400', margin: '0 0 4px' });
  const note = h(doc, 'p', {}, hint);
  paint(note, { color: color.muted, fontSize: '12px', margin: '0 0 14px' });
  const root = h(doc, 'section', {}, heading, note);
  paint(root, { borderTop: border.hairline, padding: '19px 0 4px', marginTop: '20px' });
  return root;
}

function detail(doc: Document, title: string, content: string): HTMLDetailsElement {
  const pre = h(doc, 'pre', {}, content);
  paint(pre, {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    maxHeight: '320px',
    overflow: 'auto',
    padding: '12px',
    background: color.paperDeep,
    font: font.mono,
    lineHeight: '1.5',
  });
  const node = h(doc, 'details', {}, h(doc, 'summary', {}, title), pre);
  paint(node, { margin: '9px 0', font: font.read });
  return node;
}

function traceDetail(doc: Document, trace: Trace, prefix = ''): HTMLDetailsElement {
  return detail(
    doc,
    `${prefix}${trace.name}`,
    `输入\n${json(trace.input)}\n\n结果\n${json(trace.output)}`,
  );
}

function grid(doc: Document): HTMLElement {
  const node = h(doc, 'div', {});
  paint(node, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '10px',
  });
  return node;
}

function metric(
  doc: Document,
  label: string,
  initial = '—',
): { node: HTMLElement; value: HTMLElement } {
  const heading = h(doc, 'span', {}, label);
  paint(heading, { color: color.muted, fontSize: '12px', display: 'block' });
  const value = h(doc, 'strong', {}, initial);
  paint(value, { display: 'block', fontWeight: '400', fontSize: '17px', overflowWrap: 'anywhere' });
  const node = h(doc, 'div', {}, heading, value);
  paint(node, {
    border: border.hairline,
    padding: '10px 12px',
    minWidth: '0',
    background: color.paperDeep,
  });
  return { node, value };
}

/** Read-only diagnostics. This never changes the messages sent to the model. */
export function bindStatus(options: {
  doc: Document;
  menu: HTMLButtonElement;
  panel: HTMLElement;
  dialog: HTMLDialogElement;
  session: SimSession;
  showPage: () => void;
  getJournal: () => Journal | null;
  journalReady: Promise<Journal | null>;
}) {
  const { doc, menu, panel, dialog, session, showPage, getJournal, journalReady } = options;
  const root = h(doc, 'div', { class: 'status-page' });
  paint(root, {
    boxSizing: 'border-box',
    padding: '30px clamp(22px, 4vw, 48px) 36px',
    color: color.ink,
    font: font.body,
  });
  const eyebrow = h(doc, 'p', {}, '设置 / 状态');
  paint(eyebrow, { color: color.muted, fontSize: '12px', margin: '0 0 7px' });
  const title = h(doc, 'h1', {}, '运行状态');
  paint(title, { margin: '0', fontSize: '28px', fontWeight: '400' });
  const intro = h(doc, 'p', {}, '查看世界、蜘蛛和本次页面的会话活动。');
  paint(intro, { color: color.muted, margin: '8px 0 0', fontSize: '13px' });

  const sessionSection = section(doc, '会话状态', '实时诊断 · 数据仅在此浏览器查看');
  const phase = h(doc, 'p', { id: 'status-phase', 'aria-live': 'polite' }, '等待指令');
  paint(phase, {
    display: 'inline-block',
    margin: '0 0 14px',
    padding: '3px 9px',
    border: border.ink,
    fontSize: '12px',
  });
  const stats = grid(doc);
  const modelMetric = metric(doc, '当前模型', '未开始');
  const requestMetric = metric(doc, '模型请求', '0 次');
  const toolMetric = metric(doc, '工具调用', '0 次');
  const resultMetric = metric(doc, '已返回 / 失败', '0 / 0');
  stats.append(modelMetric.node, requestMetric.node, toolMetric.node, resultMetric.node);
  const usage = h(doc, 'p', { id: 'status-context-usage' }, '上下文占用：等待模型返回用量');
  const meter = h(doc, 'progress', {
    id: 'status-context-meter',
    max: '100',
    value: '0',
    hidden: true,
  });
  paint(meter, { width: '100%', accentColor: color.ink });
  const explanation = h(
    doc,
    'p',
    {},
    '占用使用最近一次模型请求返回的输入 token；不含当前未完成的请求。未返回用量或未设置上下文上限时无法计算。',
  );
  paint(explanation, { color: color.muted, fontSize: '12px' });
  const contextHeading = h(doc, 'h3', {}, '请求上下文与用量');
  paint(contextHeading, { fontSize: '15px', fontWeight: '400', margin: '20px 0 8px' });
  const contextNote = h(
    doc,
    'p',
    {},
    '逐次展开可查看指令、消息和可用工具。字节占比仅比较展示的内容，不等于 token 占比；工具定义及服务商封装未计入。',
  );
  paint(contextNote, { color: color.muted, fontSize: '12px' });
  const context = h(doc, 'div', { id: 'status-context' }, '尚无请求');
  const timelineHeading = h(doc, 'h3', {}, '实时工具调用');
  paint(timelineHeading, { fontSize: '15px', fontWeight: '400', margin: '20px 0 8px' });
  const timeline = h(doc, 'div', { id: 'status-tools' });
  const distribution = h(doc, 'div', { id: 'status-tool-distribution' });
  const empty = h(doc, 'p', {}, '本次页面还没有工具调用。');
  paint(empty, { color: color.muted, fontSize: '13px' });
  timeline.append(empty);
  const savedHeading = h(doc, 'h3', {}, '已保存的工具记录');
  paint(savedHeading, { fontSize: '15px', fontWeight: '400', margin: '20px 0 8px' });
  const savedNote = h(doc, 'p', {}, '最多显示最近 30 条；会话精简后旧记录可能不可用。');
  paint(savedNote, { color: color.muted, fontSize: '12px' });
  const saved = h(doc, 'div', { id: 'status-saved' }, '正在读取…');
  sessionSection.append(
    phase,
    stats,
    usage,
    meter,
    explanation,
    contextHeading,
    contextNote,
    context,
    timelineHeading,
    distribution,
    timeline,
    savedHeading,
    savedNote,
    saved,
  );
  const worldSection = section(doc, '世界状态', '实时读取 · 每秒更新');
  const worldText = h(doc, 'div', { id: 'status-world' });
  const worldGrid = grid(doc);
  const worldTime = metric(doc, '世界时间');
  const worldLight = metric(doc, '光照 / 视距');
  const worldEntities = metric(doc, '世界物体');
  const worldSeed = metric(doc, '世界种子');
  worldGrid.append(worldTime.node, worldLight.node, worldEntities.node, worldSeed.node);
  const worldDetails = detail(doc, '物体分类与地点', '正在读取…');
  worldDetails.id = 'status-world-details';
  worldText.append(worldGrid, worldDetails);
  worldSection.append(worldText);
  const spiderSection = section(doc, '蜘蛛状态', '位置、身体、视野和可交互目标');
  const spiderText = h(doc, 'div', { id: 'status-spider' });
  const spiderGrid = grid(doc);
  const spiderPosition = metric(doc, '位置 x / y / z');
  const spiderBody = metric(doc, '朝向 / 速度');
  const spiderHeight = metric(doc, '地面 / 身体高度');
  const spiderPlace = metric(doc, '所在环境');
  spiderGrid.append(spiderPosition.node, spiderBody.node, spiderHeight.node, spiderPlace.node);
  const spiderDetails = detail(doc, '附近目标、背上物品和通行信息', '正在读取…');
  spiderDetails.id = 'status-spider-details';
  spiderText.append(spiderGrid, spiderDetails);
  spiderSection.append(spiderText);
  root.append(eyebrow, title, intro, sessionSection, worldSection, spiderSection);
  panel.replaceChildren(root);

  let limit: number | null = null;
  let pending: { name: string; input: unknown; node: HTMLDetailsElement; started: number } | null =
    null;
  let calls = 0;
  let returned = 0;
  let failures = 0;
  let requests = 0;
  const toolCounts = new Map<string, number>();
  let latestRequest: HTMLDetailsElement | null = null;

  const updateCounts = (): void => {
    requestMetric.value.textContent = `${requests} 次`;
    toolMetric.value.textContent = `${calls} 次`;
    resultMetric.value.textContent = `${returned} / ${failures}`;
    distribution.replaceChildren(
      ...Array.from(toolCounts, ([name, count]) => {
        const label = h(
          doc,
          'div',
          {},
          `${name} · ${count} 次 · ${Math.round((count / calls) * 100)}%`,
        );
        paint(label, { fontSize: '12px', color: color.muted });
        return label;
      }),
    );
  };

  const refresh = (): void => {
    const world = session.world;
    const info = session.worldInfo();
    const self = session.sense(true);
    const observation = session.observe();
    const kinds: Record<string, number> = {};
    for (const entity of world.entities) kinds[entity.kind] = (kinds[entity.kind] ?? 0) + 1;
    worldTime.value.textContent = `${info.clock.localTime} · ${info.clock.phase}`;
    worldLight.value.textContent = `${Math.round(info.view * 100)}% / ${number(observation.view)}`;
    worldEntities.value.textContent = `${world.entities.length} 个`;
    worldSeed.value.textContent = String(world.seed);
    worldDetails.querySelector('pre')!.textContent = json({
      物体分类: kinds,
      用户标记: world.marks,
      家园地标: session.landmarks(),
      可见物体: observation.entities.length,
      视野外: observation.beyond,
      遮挡: observation.hidden,
    });
    spiderPosition.value.textContent = `(${number(self.x)}, ${number(self.y)}, ${number(self.z)})`;
    spiderBody.value.textContent = `${number(self.heading)}° / ${number(self.speed)}`;
    spiderHeight.value.textContent = `${number(self.ground)} / ${number(self.height)}`;
    spiderPlace.value.textContent = `${self.home ? '在巢里' : self.wet ? '在水中' : '在陆地'} · 灯${info.lamp ? '开' : '关'}`;
    spiderDetails.querySelector('pre')!.textContent = json({
      附近可操作目标: session.near(),
      背上物品: self.carrying,
      前方: self.ahead,
      可行方向: self.ways,
      水深: self.waterDepth,
      浮水: self.swimming,
      水边: self.water,
      岸边: self.shore,
      草丛: self.cover,
      可见物体: observation.entities,
      地形: observation.terrain,
    });
  };

  const refreshHistory = async (): Promise<void> => {
    const journal = getJournal() ?? (await journalReady);
    const traces =
      journal?.session.turns.flatMap((turn) => turn.tools ?? []).slice(-HISTORY_LIMIT) ?? [];
    saved.replaceChildren(
      ...(traces.length
        ? traces.map((trace) => traceDetail(doc, trace))
        : [doc.createTextNode('没有可用的已保存记录。')]),
    );
  };

  menu.addEventListener('click', () => {
    showPage();
    refresh();
    void refreshHistory();
  });
  window.setInterval(() => {
    if (dialog.open && !panel.hidden) refresh();
  }, REFRESH_MS);

  return {
    start(settings: PilotSettings): void {
      limit = settings.mode === 'local' ? 4096 : contextTokensOf(settings.contextTokens);
      modelMetric.value.textContent =
        settings.mode === 'local' ? '本机模型' : settings.model || '未配置';
      phase.textContent = '正在处理指令';
      usage.textContent = '上下文占用：等待模型返回用量';
      meter.hidden = true;
      pending = null;
    },
    event(event: AgentEvent): void {
      if (event.type === 'context') {
        if (requests === 0) context.replaceChildren();
        requests += 1;
        updateCounts();
        const components = [
          { role: '系统指令', bytes: byteSize(event.instructions) },
          ...(Array.isArray(event.messages)
            ? event.messages.map((message: { role?: string }) => ({
                role: message.role ?? '未知',
                bytes: byteSize(message),
              }))
            : []),
        ];
        const total = components.reduce((sum, item) => sum + item.bytes, 0);
        const sizes = components.map((item) => ({
          role: item.role,
          bytes: item.bytes,
          share: total ? `${((item.bytes / total) * 100).toFixed(1)}%` : '—',
        }));
        latestRequest = detail(
          doc,
          `第 ${event.step + 1} 次请求${event.local ? '（本机适配前）' : ''} · ${components.length} 项 · ${total.toLocaleString()} 字节`,
          json({
            字节占比: sizes,
            可用工具: event.tools,
            instructions: event.instructions,
            messages: event.messages,
          }),
        );
        latestRequest.dataset.step = String(event.step);
        context.append(latestRequest);
        while (context.childElementCount > HISTORY_LIMIT) context.firstElementChild!.remove();
      } else if (event.type === 'usage') {
        const input = event.input;
        const output = event.output;
        usage.textContent =
          input == null
            ? '上下文占用：模型未返回输入用量'
            : `最近请求输入 ${input.toLocaleString()} token${limit ? ` / 上限 ${limit.toLocaleString()} · ${((input / limit) * 100).toFixed(1)}%` : ' · 未设置上限'}${output == null ? '' : ` · 输出 ${output.toLocaleString()}`}${event.cacheRead == null ? '' : ` · 缓存读取 ${event.cacheRead.toLocaleString()}`}`;
        meter.hidden = input == null || limit == null;
        if (input != null && limit != null) meter.value = Math.min(100, (input / limit) * 100);
        if (latestRequest?.dataset.step === String(event.step)) {
          const report = h(
            doc,
            'p',
            {},
            `模型用量 · 输入 ${event.input ?? '未返回'} · 输出 ${event.output ?? '未返回'} · 缓存读取 ${event.cacheRead ?? '未返回'} · 缓存写入 ${event.cacheWrite ?? '未返回'} · 推理 ${event.reasoning ?? '未返回'} token`,
          );
          paint(report, { color: color.muted, fontSize: '12px' });
          latestRequest.insertBefore(report, latestRequest.querySelector('pre'));
        }
      } else if (event.type === 'tool-call') {
        empty.remove();
        calls += 1;
        toolCounts.set(event.name, (toolCounts.get(event.name) ?? 0) + 1);
        updateCounts();
        const node = traceDetail(
          doc,
          { name: event.name, input: event.input, output: '执行中' },
          '执行中 · ',
        );
        timeline.append(node);
        while (timeline.childElementCount > HISTORY_LIMIT) timeline.firstElementChild!.remove();
        pending = { name: event.name, input: event.input, node, started: performance.now() };
        phase.textContent = `正在调用 ${event.name}`;
      } else if (event.type === 'tool-result') {
        const trace = {
          name: event.name,
          input: pending?.name === event.name ? pending.input : null,
          output: event.output,
        };
        const failed =
          typeof event.output === 'object' &&
          event.output !== null &&
          'ok' in event.output &&
          event.output.ok === false;
        returned += 1;
        if (failed) failures += 1;
        updateCounts();
        const elapsed =
          pending?.name === event.name
            ? ` · ${number(performance.now() - pending.started)} ms`
            : '';
        const next = traceDetail(
          doc,
          trace,
          `${failed ? '失败' : '已返回'}${elapsed} · 输入 ${byteSize(trace.input)} B / 输出 ${byteSize(trace.output)} B · `,
        );
        if (pending?.name === event.name) {
          next.open = pending.node.open;
          pending.node.replaceWith(next);
        } else {
          empty.remove();
          timeline.append(next);
        }
        while (timeline.childElementCount > HISTORY_LIMIT) timeline.firstElementChild!.remove();
        pending = null;
        phase.textContent = '正在处理指令';
      } else if (event.type === 'error') {
        phase.textContent = `出错：${event.message}`;
        if (pending) {
          failures += 1;
          updateCounts();
          pending.node.querySelector('summary')!.textContent = `失败 · ${pending.name}`;
          pending.node.querySelector('pre')!.textContent =
            `输入\n${json(pending.input)}\n\n错误\n${event.message}`;
          pending = null;
        }
      }
    },
    finish(message: string): void {
      if (pending) {
        pending.node.querySelector('summary')!.textContent = `${message} · ${pending.name}`;
        pending = null;
      }
      phase.textContent = message;
      if (dialog.open && !panel.hidden) void refreshHistory();
    },
  };
}
