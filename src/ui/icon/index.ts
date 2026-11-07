import { h } from '../dom/index.js';
import { bindFocus, paint } from '../style.js';
import { border, color } from '../token.js';

const GEAR =
  'M6.9 1.15h2.2l.22 1.35a4.7 4.7 0 0 1 1.05.6l1.15-.7.95.95-.7 1.15c.26.32.47.67.6 1.05l1.35.22v2.2l-1.35.22a4.7 4.7 0 0 1-.6 1.05l.7 1.15-.95.95-1.15-.7a4.7 4.7 0 0 1-1.05.6l-.22 1.35H6.9l-.22-1.35a4.7 4.7 0 0 1-1.05-.6l-1.15.7-.95-.95.7-1.15a4.7 4.7 0 0 1-.6-1.05l-1.35-.22V6.77l1.35-.22c.13-.38.34-.73.6-1.05l-.7-1.15.95-.95 1.15.7c.32-.26.67-.47 1.05-.6L6.9 1.15zM8 5.65a2.35 2.35 0 1 0 0 4.7 2.35 2.35 0 1 0 0-4.7z';
const GITHUB =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z';
const STAR =
  'M8 1.6l1.94 3.93 4.34.63-3.14 3.06.74 4.32L8 11.5l-3.88 2.04.74-4.32L1.72 6.16l4.34-.63Z';
const TERMINAL = 'M1 3h14v10H1V3Zm1 1v8h12V4H2Zm2 1.2v3.6l2.2-1.8L4 5.2Zm4 3.8h4v1H8v-1Z';
const CLOUD = 'M4.5 12.5h7a3.1 3.1 0 0 0 .35-6.18A4.6 4.6 0 0 0 3.3 7.5a2.6 2.6 0 0 0 1.2 5Z';

const GLYPHS = {
  cloud: { d: CLOUD, rule: 'nonzero' },
  gear: { d: GEAR, rule: 'evenodd' },
  github: { d: GITHUB, rule: 'nonzero' },
  star: { d: STAR, rule: 'nonzero' },
  terminal: { d: TERMINAL, rule: 'evenodd' },
} as const;

export type IconName = keyof typeof GLYPHS;

export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', GLYPHS[name].rule);
  path.setAttribute('d', GLYPHS[name].d);
  svg.append(path);
  return svg;
}

export function iconButton(
  doc: Document,
  name: IconName,
  options: { id?: string; label: string },
): HTMLButtonElement {
  const node = h(doc, 'button', {
    type: 'button',
    'aria-label': options.label,
    ...(options.id === undefined ? {} : { id: options.id }),
  });
  paint(node, {
    display: 'grid',
    placeItems: 'center',
    width: '2em',
    height: '2em',
    padding: '0',
    border: border.ink,
    background: color.paper,
    color: color.ink,
    cursor: 'pointer',
  });
  bindFocus(node);
  node.append(icon(doc, name));
  return node;
}
