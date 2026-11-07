import { h } from '../../ui/dom/index.js';
import { button } from '../../ui/button/index.js';
import { paint } from '../../ui/style.js';
import { border, color } from '../../ui/token.js';

export function localModelPanel(doc: Document): HTMLElement {
  const panel = h(doc, 'div', { id: 'local-model-panel', hidden: true });
  paint(panel, { marginTop: '18px', maxWidth: '760px' });
  const card = h(doc, 'section', { 'aria-label': '本机模型' });
  paint(card, {
    padding: 'clamp(16px, 3vw, 24px)',
    border: border.hairline,
    background: color.paperDeep,
  });
  const title = h(doc, 'h2', {}, 'Qwen3 0.6B');
  paint(title, { margin: '0 0 6px', fontSize: '21px', fontWeight: '400' });
  const intro = h(doc, 'p', {}, '在这台电脑上运行，无需密钥。首次下载后可使用本地缓存。');
  paint(intro, { margin: '0', color: color.muted });
  const facts = h(doc, 'div');
  paint(facts, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '16px',
    margin: '22px 0',
  });
  for (const [label, value] of [
    ['首次下载', '数百 MB'],
    ['显存占用', '约 1.4 GB'],
    ['运行环境', '支持 WebGPU 的桌面浏览器'],
  ]) {
    const labelNode = h(doc, 'p', {}, label);
    paint(labelNode, { margin: '0 0 4px', color: color.muted, fontSize: '12px' });
    const valueNode = h(doc, 'p', {}, value);
    paint(valueNode, { margin: '0' });
    facts.append(h(doc, 'div', {}, labelNode, valueNode));
  }
  const actions = h(doc, 'div');
  paint(actions, { display: 'flex', flexWrap: 'wrap', gap: '12px' });
  const load = button(doc, '加载本机模型', { id: 'local-load', type: 'button' });
  paint(load, { padding: '8px 16px', background: color.ink, color: color.paper });
  const unload = button(doc, '释放缓存', { id: 'local-unload', type: 'button', variant: 'ghost' });
  actions.append(load, unload);
  const hint = h(doc, 'p', {}, '释放缓存只释放运行时占用，已下载的模型会保留。');
  paint(hint, { margin: '10px 0 20px', color: color.muted, fontSize: '12px' });
  const status = h(doc, 'p', { id: 'local-status', role: 'status' }, '尚未加载本机模型');
  paint(status, { margin: '0 0 8px' });
  const progress = h(doc, 'progress', {
    id: 'local-progress',
    max: '1',
    hidden: true,
    'aria-label': '模型加载进度',
    'aria-describedby': 'local-status local-progress-detail',
  });
  paint(progress, { width: '100%', height: '10px', accentColor: color.ink });
  const detail = h(doc, 'p', { id: 'local-progress-detail' });
  paint(detail, { margin: '6px 0 0', color: color.muted, fontSize: '12px' });
  const offline = h(
    doc,
    'p',
    { id: 'offline-status', role: 'status' },
    '加载时会同时准备网页离线缓存。',
  );
  paint(offline, {
    margin: '18px 0 0',
    paddingTop: '14px',
    borderTop: border.hairline,
    color: color.muted,
    fontSize: '12px',
  });
  card.append(title, intro, facts, actions, hint, status, progress, detail, offline);
  const guide = h(doc, 'section', { 'aria-label': '玩法提示' });
  paint(guide, { marginTop: '24px' });
  const guideTitle = h(doc, 'h3', {}, '先试试简单动作');
  paint(guideTitle, { margin: '0 0 10px', fontSize: '16px', fontWeight: '400' });
  const examples = h(doc, 'div');
  paint(examples, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
  for (const text of ['向前走一米', '右转九十度', '把身体抬高到一米']) {
    const example = h(doc, 'span', {}, `「${text}」`);
    paint(example, { padding: '6px 10px', border: border.hairline });
    examples.append(example);
  }
  const limits = h(
    doc,
    'p',
    {},
    '支持观察、走路、转向和升降身体。每条指令独立执行，最多尝试 6 步；复杂指令可能失败。刷新页面后需重新加载模型，优先读取缓存。',
  );
  paint(limits, { margin: '12px 0 0', color: color.muted, fontSize: '13px' });
  guide.append(guideTitle, examples, limits);
  panel.append(card, guide);
  return panel;
}
