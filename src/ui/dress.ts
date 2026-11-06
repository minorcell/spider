import { onMedia, paint } from './style.js';
import { installTheme } from './theme.js';
import { border, color, font, media, typeface, type ThemeName } from './token.js';

const serif = { color: color.ink, font: font.body, letterSpacing: '0.04em' };

export function paintDocument(doc: Document, theme: ThemeName = 'day'): void {
  installTheme(doc, theme);
  const fill = { margin: '0', height: '100%', overflow: 'hidden', background: color.paper };
  paint(doc.documentElement, fill);
  paint(doc.body, { ...fill, ...serif });
}

export function paintStage(sheet: HTMLElement, stage: HTMLElement): void {
  const fill = { position: 'absolute', inset: '0', width: '100%', height: '100dvh' } as const;
  paint(sheet, fill);
  paint(stage, fill);
}

export function paintCanvas(canvas: HTMLElement): void {
  paint(canvas, { display: 'block', width: '100%', height: '100%' });
}

export function paintTrace(trace: HTMLElement, tail: HTMLElement): void {
  paint(trace, {
    ...serif,
    position: 'absolute',
    left: '0',
    top: '0',
    zIndex: '2',
    boxSizing: 'border-box',
    width: 'max-content',
    maxWidth: 'min(18rem, calc(100% - 16px))',
    margin: '0',
    padding: '7px 10px 8px',
    listStyle: 'none',
    background: color.paper,
    border: border.ink,
    pointerEvents: 'none',
  });
  paint(tail, {
    position: 'absolute',
    zIndex: '2',
    width: '9px',
    height: '9px',
    background: color.paper,
    pointerEvents: 'none',
    transform: 'translateX(-50%) rotate(45deg)',
  });
}

/** Point the bubble tail. `down` hangs under the bubble, `up` sits above it. */
export function placeTail(
  tail: HTMLElement,
  top: number,
  height: number,
  x: number,
  down: boolean,
): void {
  paint(tail, {
    left: `${x}px`,
    top: down ? `${top + height - 5}px` : `${top - 5}px`,
    borderRight: down ? border.ink : '0',
    borderBottom: down ? border.ink : '0',
    borderLeft: down ? '0' : border.ink,
    borderTop: down ? '0' : border.ink,
  });
  tail.hidden = false;
}

export function paintObserve(layer: HTMLElement, readout: HTMLElement, pins: HTMLElement): void {
  paint(layer, { position: 'absolute', inset: '0', zIndex: '2', pointerEvents: 'none' });
  paint(readout, {
    position: 'absolute',
    left: '22px',
    top: '62px',
    maxWidth: 'min(22rem, calc(100% - 44px))',
    color: color.ink,
    font: font.read,
    letterSpacing: '0.03em',
    whiteSpace: 'pre-line',
  });
  paint(pins, { position: 'absolute', inset: '0' });
}

export function paintPin(pin: HTMLElement, state: string): void {
  paint(pin, {
    position: 'absolute',
    transform: 'translate(-50%, -130%)',
    color: color.ink,
    font: font.pin,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    opacity: state === 'beyond' || state === 'hidden' ? '0.45' : '1',
  });
}

type Chrome = {
  keys: HTMLElement;
  corner: HTMLElement;
  pilot: HTMLElement;
  goal: HTMLElement;
  shell: HTMLElement;
  rail: HTMLElement;
  brand: HTMLElement;
  nav: HTMLElement;
  foot: HTMLElement;
  body: HTMLElement;
};

let chrome: Chrome | null = null;
let chromeWatch = false;

export function dressChrome(nodes: Chrome): void {
  chrome = nodes;
  paint(nodes.keys, {
    position: 'absolute',
    left: '22px',
    bottom: '18px',
    zIndex: '2',
    margin: '0',
    ...serif,
    pointerEvents: 'none',
    opacity: '0.78',
  });
  const hint = nodes.keys.querySelector('p');
  if (hint) paint(hint, { margin: '0' });
  paint(nodes.corner, {
    position: 'absolute',
    top: '18px',
    right: '22px',
    zIndex: '3',
    display: 'flex',
    gap: '8px',
  });
  paint(nodes.brand, { margin: '0 8px 28px', fontSize: '17px', letterSpacing: '0.1em' });
  const small = nodes.brand.querySelector('small');
  if (small)
    paint(small, {
      display: 'block',
      marginTop: '5px',
      color: color.muted,
      fontSize: '11px',
      letterSpacing: '0.04em',
    });
  paint(nodes.nav, { display: 'grid', gap: '4px' });
  paint(nodes.foot, {
    margin: 'auto 8px 0',
    paddingTop: '16px',
    borderTop: border.hairline,
    color: color.muted,
    fontSize: '12px',
    lineHeight: '1.5',
  });
  paint(nodes.body, { minWidth: '0', minHeight: '0', overflow: 'auto' });
  for (const section of [
    nodes.shell.querySelector('#panel-model'),
    nodes.shell.querySelector('#memory'),
  ]) {
    if (section instanceof HTMLElement)
      paint(section, { padding: '30px clamp(22px, 4vw, 48px) 36px' });
  }
  layoutChrome(false, false);
  if (chromeWatch) return;
  chromeWatch = true;
  onMedia(media.pilot, (narrow) => layoutChrome(narrow, sheetNarrowFlag));
  onMedia(media.sheet, (narrow) => layoutChrome(pilotNarrow, narrow));
}

let pilotNarrow = false;
let sheetNarrowFlag = false;

function layoutChrome(nextPilot: boolean, nextSheet: boolean): void {
  pilotNarrow = nextPilot;
  sheetNarrowFlag = nextSheet;
  const frame = chrome!;
  paint(frame.pilot, {
    ...serif,
    position: 'absolute',
    right: '22px',
    bottom: nextPilot ? '96px' : '18px',
    left: nextPilot ? '22px' : 'auto',
    zIndex: '3',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: '0',
  });
  paint(frame.goal, {
    width: nextPilot ? 'auto' : 'min(22rem, 42vw)',
    flex: nextPilot ? '1' : '0 0 auto',
  });
  paint(frame.shell, {
    display: 'grid',
    gridTemplateColumns: nextSheet ? '1fr' : '190px minmax(0, 1fr)',
    gridTemplateRows: nextSheet ? 'auto minmax(0, 1fr)' : 'none',
    height: '100%',
    minHeight: '0',
  });
  paint(frame.rail, {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '0',
    padding: nextSheet ? '17px 18px 12px' : '28px 18px 20px',
    borderRight: nextSheet ? '0' : border.ink,
    borderBottom: nextSheet ? border.ink : '0',
  });
  paint(frame.brand, { margin: nextSheet ? '0 0 14px' : '0 8px 28px' });
  paint(frame.nav, { gridTemplateColumns: nextSheet ? 'repeat(3, 1fr)' : 'none' });
  paint(frame.foot, { display: nextSheet ? 'none' : 'block' });
}

let usagePage: HTMLElement | null = null;
let usageWatch = false;
let sheetNarrow = false;
let phoneNarrow = false;

/** Style a freshly built usage page. Responsive rules stay attached to the latest page. */
export function dressUsage(root: HTMLElement): void {
  usagePage = root;
  paintUsage(root);
  layoutUsage(root);
  if (usageWatch) return;
  usageWatch = true;
  onMedia(media.sheet, (narrow) => {
    sheetNarrow = narrow;
    layoutUsage(usagePage!);
  });
  onMedia(media.phone, (narrow) => {
    phoneNarrow = narrow;
    layoutUsage(usagePage!);
  });
}

function paintUsage(root: HTMLElement): void {
  paint(root, { boxSizing: 'border-box', padding: '30px clamp(22px, 4vw, 48px) 36px', ...serif });
  const top = root.querySelector<HTMLElement>('.top');
  if (top)
    paint(top, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '20px',
      marginBottom: '27px',
    });
  const title = root.querySelector<HTMLElement>('h1');
  if (title) paint(title, { margin: '0' });
  const eyebrow = root.querySelector<HTMLElement>('.eyebrow');
  if (eyebrow)
    paint(eyebrow, {
      margin: '0 0 7px',
      color: color.muted,
      fontSize: '12px',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    });
  const actions = root.querySelector<HTMLElement>('.top-actions');
  if (actions) paint(actions, { display: 'flex', alignItems: 'center', gap: '8px' });
  const wrap = root.querySelector<HTMLElement>('.select-wrap');
  if (wrap) paint(wrap, { position: 'relative' });
  const range = root.querySelector<HTMLElement>('.range');
  if (range) {
    paint(range, {
      minWidth: '112px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '14px',
      border: border.ink,
      padding: '7px 9px',
      background: 'transparent',
      textAlign: 'left',
      color: color.ink,
      font: font.body,
      cursor: 'pointer',
    });
    range.addEventListener('click', () => {
      const open = range.getAttribute('aria-expanded') === 'true';
      range.style.outline = open ? border.ink : '';
      range.style.outlineOffset = open ? '2px' : '';
    });
  }
  const arrow = root.querySelector<HTMLElement>('.select-arrow');
  if (arrow) paint(arrow, { fontSize: '12px', lineHeight: '1' });
  const menu = root.querySelector<HTMLElement>('.select-menu');
  if (menu) {
    paint(menu, {
      position: 'absolute',
      top: 'calc(100% + 5px)',
      right: '0',
      zIndex: '5',
      minWidth: '100%',
      margin: '0',
      padding: '4px',
      border: border.ink,
      background: color.paper,
    });
    for (const option of menu.querySelectorAll<HTMLElement>('button')) {
      paint(option, {
        display: 'block',
        width: '100%',
        border: '0',
        padding: '6px 8px',
        background: 'transparent',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        color: color.ink,
        font: font.body,
        cursor: 'pointer',
      });
      option.addEventListener('mouseenter', () => {
        option.style.outline = border.ink;
        option.style.outlineOffset = '-1px';
      });
      option.addEventListener('mouseleave', () => {
        if (option.getAttribute('aria-selected') !== 'true') option.style.outline = '';
      });
      if (option.getAttribute('aria-selected') === 'true') {
        option.style.outline = border.ink;
        option.style.outlineOffset = '-1px';
      }
    }
  }
  const grid = root.querySelector<HTMLElement>('.grid');
  if (grid) paint(grid, { display: 'grid', gap: '16px' });
  const chart = root.querySelector<HTMLElement>('.chart');
  if (chart)
    paint(chart, {
      height: '216px',
      display: 'flex',
      alignItems: 'stretch',
      gap: '14px',
      padding: '20px 17px 14px',
    });
  const axis = root.querySelector<HTMLElement>('.y-axis');
  if (axis) {
    paint(axis, {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '25px',
      paddingBottom: '21px',
      color: color.muted,
      font: font.axis,
      textAlign: 'right',
    });
  }
  const bars = root.querySelector<HTMLElement>('.bars');
  if (bars) {
    paint(bars, {
      flex: '1',
      minWidth: '0',
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'space-around',
      gap: 'clamp(5px, 1.5vw, 18px)',
      borderBottom: border.ink,
      background: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(25% - 1px), ${color.grid} 25%)`,
    });
  }
  for (const group of root.querySelectorAll<HTMLElement>('.bar-group')) {
    paint(group, {
      flex: '1',
      maxWidth: '48px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: '8px',
    });
    const caption = group.querySelector('small');
    if (caption) paint(caption, { fontSize: '10px', whiteSpace: 'nowrap' });
  }
  for (const stack of root.querySelectorAll<HTMLElement>('.bar-stack')) {
    paint(stack, {
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      minHeight: '0',
    });
  }
  for (const bar of root.querySelectorAll<HTMLElement>('.bar')) {
    paint(bar, {
      display: 'block',
      width: '100%',
      minHeight: '2px',
      background: bar.classList.contains('output')
        ? color.ink
        : `repeating-linear-gradient(135deg, transparent 0, transparent 4px, ${color.hatch} 4px, ${color.hatch} 5px)`,
      opacity: bar.classList.contains('output') ? '0.68' : '1',
      border: bar.classList.contains('input') ? border.ink : '0',
      borderBottom: bar.classList.contains('input') ? '0' : '',
    });
  }
  const legend = root.querySelector<HTMLElement>('.legend');
  if (legend)
    paint(legend, { display: 'flex', gap: '15px', padding: '0 17px 15px', fontSize: '11px' });
  const donutWrap = root.querySelector<HTMLElement>('.donut-wrap');
  if (donutWrap)
    paint(donutWrap, {
      display: 'grid',
      alignItems: 'center',
      gap: '12px',
      padding: '18px 17px 17px',
    });
  const donut = root.querySelector<HTMLElement>('.donut');
  if (donut && !donut.querySelector('.donut-hole')) {
    const hole = donut.ownerDocument.createElement('span');
    hole.className = 'donut-hole';
    paint(hole, { width: '73px', height: '73px', borderRadius: '50%', background: color.paper });
    donut.append(hole);
  }
  if (donut)
    paint(donut, {
      width: '126px',
      height: '126px',
      borderRadius: '50%',
      display: 'grid',
      placeItems: 'center',
    });
  const center = root.querySelector<HTMLElement>('.donut-center');
  if (center) paint(center, { gridArea: '1/1', zIndex: '1', textAlign: 'center' });
  const strong = center?.querySelector<HTMLElement>('strong');
  if (strong) paint(strong, { display: 'block', fontSize: '19px', fontWeight: '400' });
  const centerCaption = center?.querySelector<HTMLElement>('small');
  if (centerCaption) paint(centerCaption, { color: color.muted, fontSize: '10px' });
  const breakdown = root.querySelector<HTMLElement>('.breakdown');
  if (breakdown) paint(breakdown, { display: 'grid', gap: '9px', fontSize: '12px' });
  for (const row of root.querySelectorAll<HTMLElement>('.break-row')) {
    paint(row, {
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '7px',
      alignItems: 'center',
    });
    const name = row.querySelector<HTMLElement>('.name');
    if (name) paint(name, { color: color.muted });
    const amount = row.querySelector<HTMLElement>('strong');
    if (amount) paint(amount, { fontWeight: '400' });
  }
  for (const track of root.querySelectorAll<HTMLElement>('.track')) {
    paint(track, { gridColumn: '1/-1', height: '4px', background: color.paperDeep });
  }
  for (const fill of root.querySelectorAll<HTMLElement>('.fill')) {
    paint(fill, { display: 'block', height: '100%' });
  }
  for (const name of root.querySelectorAll<HTMLElement>('.model-name')) {
    paint(name, { display: 'flex', gap: '9px', alignItems: 'center' });
  }
  for (const dot of root.querySelectorAll<HTMLElement>('.model-dot')) {
    paint(dot, {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: dot.classList.contains('blue') ? 'transparent' : color.ink,
      border: dot.classList.contains('blue') ? border.ink : '0',
    });
  }
  for (const sub of root.querySelectorAll<HTMLElement>('.sub')) {
    paint(sub, { display: 'block', marginTop: '3px', color: color.muted, fontSize: '10px' });
  }
  for (const tool of root.querySelectorAll<HTMLElement>('.tool-name')) {
    paint(tool, { fontFamily: typeface.mono, fontSize: '11px' });
  }
  const requests = root.querySelector<HTMLElement>('.requests');
  if (requests) paint(requests, { display: 'grid' });
  const requestNodes = [...root.querySelectorAll<HTMLElement>('.request')];
  requestNodes.forEach((request, index) => {
    paint(request, { borderBottom: index === requestNodes.length - 1 ? '0' : border.hairline });
    const summary = request.querySelector('summary');
    if (summary) {
      paint(summary, {
        display: 'grid',
        gap: '12px',
        alignItems: 'center',
        padding: '13px 15px',
        cursor: 'pointer',
        listStyle: 'none',
      });
      summary.addEventListener('mouseenter', () => {
        summary.style.textDecoration = 'underline';
        summary.style.textUnderlineOffset = '4px';
      });
      summary.addEventListener('mouseleave', () => {
        summary.style.textDecoration = '';
      });
    }
    const step = request.querySelector<HTMLElement>('.step');
    if (step) paint(step, { color: color.muted, font: font.step });
    const model = request.querySelector<HTMLElement>('.request-model');
    if (model) paint(model, { fontSize: '12px' });
    for (const meta of request.querySelectorAll<HTMLElement>(
      '.request-model small, .request-meta',
    )) {
      paint(meta, { display: 'block', color: color.muted, fontSize: '10px' });
    }
    for (const figure of request.querySelectorAll<HTMLElement>('.request-tokens, .request-time')) {
      paint(figure, { textAlign: 'right', font: font.mono });
    }
  });
  const empty = root.querySelector<HTMLElement>('.usage-empty');
  if (empty)
    paint(empty, { margin: '20px 15px', color: color.muted, fontSize: '11px', lineHeight: '1.5' });
  const footer = root.querySelector<HTMLElement>('.footer-note');
  if (footer)
    paint(footer, { margin: '20px 0 0', color: color.muted, fontSize: '11px', lineHeight: '1.5' });
}

function layoutUsage(root: HTMLElement): void {
  const grid = root.querySelector<HTMLElement>('.grid');
  if (grid)
    paint(grid, {
      gridTemplateColumns: sheetNarrow ? '1fr' : 'minmax(0, 1.45fr) minmax(260px, 0.85fr)',
    });
  const top = root.querySelector<HTMLElement>('.top');
  if (top) paint(top, { flexDirection: phoneNarrow ? 'column' : 'row' });
  const actions = root.querySelector<HTMLElement>('.top-actions');
  if (actions) paint(actions, { width: phoneNarrow ? '100%' : 'auto' });
  const range = root.querySelector<HTMLElement>('.range');
  if (range) paint(range, { flex: phoneNarrow ? '1' : '0 0 auto' });
  const wrap = root.querySelector<HTMLElement>('.donut-wrap');
  if (wrap) paint(wrap, { gridTemplateColumns: phoneNarrow ? '115px 1fr' : '135px 1fr' });
  for (const summary of root.querySelectorAll<HTMLElement>('.request summary')) {
    paint(summary, {
      gridTemplateColumns: phoneNarrow
        ? '55px minmax(100px, 1fr) 75px 18px'
        : '76px minmax(130px, 1fr) 110px 90px 22px',
    });
  }
  for (const time of root.querySelectorAll<HTMLElement>('.request-time')) {
    time.style.display = phoneNarrow ? 'none' : '';
  }
}
