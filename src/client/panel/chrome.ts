import { h } from '../../ui/dom/index.js';
import { button } from '../../ui/button/index.js';
import { dialog, dialogActions, dialogTitle } from '../../ui/dialog/index.js';
import { field } from '../../ui/field/index.js';
import { menuSelect } from '../../ui/select/index.js';
import { iconButton } from '../../ui/icon/index.js';
import { dressChrome, paintTrace } from '../../ui/dress.js';
import { paint } from '../../ui/style.js';
import { color } from '../../ui/token.js';
import { switchField } from '../../ui/switch/index.js';

function eyebrow(doc: Document, text: string): HTMLParagraphElement {
  const node = h(doc, 'p', { class: 'eyebrow' }, text);
  paint(node, {
    margin: '0 0 7px',
    color: color.muted,
    fontSize: '12px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: '1',
  });
  return node;
}

function pageTitle(doc: Document, text: string): HTMLHeadingElement {
  const node = h(doc, 'h1', {}, text);
  paint(node, {
    margin: '0 0 16px',
    fontSize: 'clamp(25px, 3vw, 32px)',
    fontWeight: '400',
    letterSpacing: '0.06em',
  });
  return node;
}

function note(doc: Document, text: string): HTMLParagraphElement {
  const node = h(doc, 'p', {}, text);
  paint(node, { margin: '0 0 14px', opacity: '0.8' });
  return node;
}

/** The page chrome: corner, pilot, settings, and the leave dialog. */
export function buildChrome(doc: Document): DocumentFragment {
  const fragment = doc.createDocumentFragment();

  const keys = h(doc, 'aside', { id: 'keys' });
  keys.append(h(doc, 'p', { id: 'look-hint' }, '拖动旋转视角　滚轮缩放'));

  const corner = h(doc, 'div', { id: 'corner' });
  const observe = button(doc, '观察', { id: 'observe-open', pressed: false });
  const settingsOpen = iconButton(doc, 'gear', { id: 'settings-open', label: '设置' });
  settingsOpen.setAttribute('aria-haspopup', 'dialog');
  settingsOpen.setAttribute('aria-controls', 'settings');
  settingsOpen.setAttribute('aria-expanded', 'false');
  corner.append(observe, settingsOpen);

  const trace = h(doc, 'ol', { id: 'trace', hidden: true });
  const tail = h(doc, 'span', { id: 'trace-tail', hidden: true });
  paintTrace(trace, tail);

  const pilot = h(doc, 'form', { id: 'pilot' });
  const goal = field(doc, {
    label: '',
    name: 'goal',
    id: 'goal',
    placeholder: '未填写模型',
    autocomplete: 'off',
  }).querySelector('input')!;
  goal.style.width = 'min(22rem, 42vw)';
  goal.style.padding = '0 0.5em';
  pilot.append(
    h(doc, 'span', { id: 'pilot-model' }),
    goal,
    button(doc, '发送', { id: 'pilot-send', type: 'submit' }),
  );

  const settings = dialog(doc, { id: 'settings', label: '设置', kind: 'sheet' });
  const shell = h(doc, 'div', { class: 'settings-shell' });
  const rail = h(doc, 'aside', { class: 'settings-rail' });
  const brand = h(doc, 'p', { class: 'brand' }, 'Token 蛛', h(doc, 'small', {}, '设置'));
  const nav = h(doc, 'nav', { class: 'nav', 'aria-label': '设置导航' });
  const menuModel = button(doc, '模型', { variant: 'quiet', id: 'menu-model' });
  menuModel.setAttribute('aria-current', 'page');
  nav.append(
    menuModel,
    button(doc, '记忆', { variant: 'quiet', id: 'menu-memory' }),
    button(doc, '用量', { variant: 'quiet', id: 'menu-usage' }),
  );
  const foot = h(doc, 'p', { class: 'rail-foot' });
  foot.append('请求直接从这台浏览器发出。', h(doc, 'br'), '数据只保存在这里。');
  const close = button(doc, '关闭', { id: 'settings-close' });
  paint(close, { marginTop: '12px' });
  rail.append(brand, nav, foot, close);

  const body = h(doc, 'div', { class: 'settings-body' });
  const model = h(doc, 'section', { id: 'panel-model' });
  const settingsForm = h(doc, 'form', { id: 'settings-form' });
  settingsForm.append(
    eyebrow(doc, '设置 / 模型'),
    pageTitle(doc, '模型'),
    field(doc, {
      label: 'Base URL',
      name: 'baseURL',
      kind: 'url',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'https://api.deepseek.com/v1',
    }),
    field(doc, {
      label: 'Model ID',
      name: 'model',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'deepseek-chat',
    }),
    field(doc, {
      label: 'API Key',
      name: 'apiKey',
      kind: 'password',
      autocomplete: 'off',
      spellcheck: false,
    }),
    field(doc, {
      label: '上下文长度 k token',
      name: 'contextTokens',
      kind: 'number',
      min: 1,
      step: 1,
      placeholder: '不限制',
    }),
    switchField(doc, { name: 'compact', label: '自动压缩' }),
    field(doc, {
      label: '压缩阈值 KB',
      name: 'compactKb',
      kind: 'number',
      min: 1,
      step: 1,
      placeholder: '400',
    }),
    note(
      doc,
      '地址、模型名和 Key 记在这台浏览器的 localStorage 里。三项都留下它才会走，留空就站着。地址填到 /v1 为止。上下文长度和压缩阈值都按 k 填：8 就是 8k token，400 就是 400 KB。都可以留空。打开自动压缩又不填阈值时，按 400 KB。',
    ),
  );
  model.append(settingsForm);

  const memory = h(doc, 'section', { id: 'memory', hidden: true });
  const memoryForm = h(doc, 'form', { id: 'memory-form' });
  memoryForm.append(
    eyebrow(doc, '设置 / 记忆'),
    pageTitle(doc, '记忆'),
    switchField(doc, { name: 'autoMemory', label: '自动记忆' }),
    note(doc, '开启后，页面空闲 30 分钟以上时，Agent 会自动把当天的对话整理进日记，不会弹出窗口。'),
    (() => {
      const label = h(
        doc,
        'label',
        {},
        '日期',
        menuSelect(doc, { name: 'date', placeholder: '还没有日记' }),
      );
      paint(label, { display: 'grid', gap: '4px', margin: '0 0 12px' });
      return label;
    })(),
    field(doc, { label: '目录', name: 'line', autocomplete: 'off' }),
    field(doc, { label: '记下的', name: 'noted', kind: 'textarea', rows: 4 }),
    field(doc, { label: '摘要', name: 'summary', kind: 'textarea', rows: 5 }),
    h(doc, 'p', { id: 'memory-empty', hidden: true }, '还没有日记。'),
  );
  memory.append(memoryForm);
  body.append(model, memory, h(doc, 'section', { id: 'usage', hidden: true }));
  shell.append(rail, body);
  settings.append(shell);

  const leaveClose = button(doc, '确定关闭', { id: 'leave-close' });
  leaveClose.value = 'cancel';
  const leaveSummarize = button(doc, '总结', { id: 'leave-summarize' });
  leaveSummarize.value = 'default';
  const leave = dialog(doc, { id: 'leave', label: '离开', kind: 'card' });
  const leaveForm = h(doc, 'form', { method: 'dialog' });
  leaveForm.append(
    dialogTitle(doc, '要在离开前记一笔吗'),
    note(doc, '今天的对话还没写进日记。'),
    dialogActions(doc, leaveClose, leaveSummarize),
  );
  leave.append(leaveForm);

  paint(keys, { color: color.ink });
  fragment.append(keys, corner, trace, tail, pilot, settings, leave);
  dressChrome({
    keys,
    corner,
    pilot,
    goal,
    shell,
    rail,
    brand,
    nav,
    foot,
    body,
  });
  return fragment;
}
