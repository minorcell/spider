import { h } from '../../ui/dom/index.js';
import { button } from '../../ui/button/index.js';
import { dialog, dialogActions, dialogTitle } from '../../ui/dialog/index.js';
import { field } from '../../ui/field/index.js';
import { menuSelect } from '../../ui/select/index.js';
import { icon, iconButton } from '../../ui/icon/index.js';
import { dressChrome, paintTrace } from '../../ui/dress.js';
import { bindFocus, paint } from '../../ui/style.js';
import { border, color, font } from '../../ui/token.js';
import { switchField } from '../../ui/switch/index.js';
import { REPO, REPO_STARS } from '../stars.js';

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

/** Top-left link to the repo: GitHub mark, a star, and the live count. */
function githubBadge(doc: Document): HTMLAnchorElement {
  const badge = h(doc, 'a', {
    id: 'github',
    href: `https://github.com/${REPO}`,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': '在 GitHub 上给 Token 蛛点一个 Star',
    title: '去 GitHub 点个 Star',
  });
  const stars = h(doc, 'span', { id: 'github-stars' });
  const star = icon(doc, 'star');
  stars.append(star, h(doc, 'span', { id: 'github-stars-count' }, REPO_STARS));
  badge.append(icon(doc, 'github'), stars);

  paint(badge, {
    position: 'absolute',
    top: '18px',
    left: '22px',
    zIndex: '3',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 9px',
    border: border.ink,
    background: color.paper,
    color: color.ink,
    font: font.read,
    letterSpacing: '0.02em',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  });
  paint(stars, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    paddingLeft: '8px',
    borderLeft: border.ink,
  });
  const invert = (on: boolean): void => {
    paint(badge, {
      background: on ? color.ink : color.paper,
      color: on ? color.paper : color.ink,
    });
    star.style.opacity = on ? '1' : '0.85';
  };
  invert(false);
  badge.addEventListener('mouseenter', () => invert(true));
  badge.addEventListener('mouseleave', () => invert(false));
  bindFocus(badge);
  return badge;
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
    button(doc, '云端', { variant: 'quiet', id: 'menu-cloud' }),
  );
  const foot = h(doc, 'p', { class: 'rail-foot' });
  foot.append(
    '请求直接从这台浏览器发出。',
    h(doc, 'br'),
    '模型密钥留在这台电脑。进度可以交给你自己的对象存储。',
  );
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
    switchField(doc, { name: 'thinking', label: '思考', checked: true }),
    note(
      doc,
      '地址、模型名和 Key 保存在当前浏览器里。三项都留下它才会走，留空就站着。地址填到 /v1 为止。上下文长度按 k 填：8 就是 8k token。留空则不限制。对话写到窗口的 80% 时，会自动收成一段摘要。关掉思考会让模型直接回答，模型不支持时可能报错。',
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

  const cloud = h(doc, 'section', { id: 'panel-cloud', hidden: true });
  const cloudForm = h(doc, 'form', { id: 'cloud-form' });
  cloudForm.append(
    eyebrow(doc, '设置 / 云端'),
    pageTitle(doc, '云端'),
    field(doc, {
      label: '端点',
      name: 'endpoint',
      kind: 'url',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'https://s3.amazonaws.com',
    }),
    field(doc, {
      label: '区域',
      name: 'region',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'us-east-1',
    }),
    field(doc, {
      label: '桶',
      name: 'bucket',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'spider',
    }),
    field(doc, {
      label: 'Access Key',
      name: 'accessKeyId',
      autocomplete: 'off',
      spellcheck: false,
    }),
    field(doc, {
      label: 'Secret Key',
      name: 'secretAccessKey',
      kind: 'password',
      autocomplete: 'off',
      spellcheck: false,
    }),
    button(doc, '检查并启用', { id: 'cloud-probe', type: 'submit' }),
    h(doc, 'p', { id: 'cloud-status' }),
    note(
      doc,
      '填你自己的 S3 兼容端点。密钥只留在这台浏览器里。启用后，世界和日记会同步成一份当前进度。用量和模型密钥不同步。',
    ),
  );
  paint(cloud, { padding: '30px clamp(22px, 4vw, 48px) 36px' });
  cloud.append(cloudForm);

  body.append(model, memory, h(doc, 'section', { id: 'usage', hidden: true }), cloud);
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

  const hold = h(doc, 'div', { id: 'cloud-hold' });
  const holdText = h(doc, 'p', {}, '另一台电脑正在玩这只蜘蛛。');
  const takeover = button(doc, '改在这台电脑玩', { id: 'cloud-takeover', type: 'button' });
  hold.append(holdText, takeover);
  paint(hold, {
    display: 'none',
    position: 'absolute',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '4',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    border: border.ink,
    background: color.paper,
    color: color.ink,
  });
  paint(holdText, { margin: '0' });

  const useRemote = button(doc, '用云端的', { id: 'cloud-use-remote', type: 'button' });
  const useLocal = button(doc, '用这台电脑的', { id: 'cloud-use-local', type: 'button' });
  const choice = dialog(doc, { id: 'cloud-choice', label: '选择存档', kind: 'card' });
  const choiceForm = h(doc, 'form', { method: 'dialog' });
  choiceForm.append(
    dialogTitle(doc, '两份进度不一样'),
    note(doc, '两边都改过。选一份当作当前进度，另一份会留在云端。'),
    dialogActions(doc, useRemote, useLocal),
  );
  choice.append(choiceForm);

  paint(keys, { color: color.ink });
  fragment.append(
    keys,
    githubBadge(doc),
    corner,
    trace,
    tail,
    pilot,
    settings,
    leave,
    hold,
    choice,
  );
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
