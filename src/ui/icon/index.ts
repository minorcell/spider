import { h } from '../dom/index.js';
import { bindFocus, paint } from '../style.js';
import { border, color } from '../token.js';

const PATHS = {
  gear: 'M6.9 1.15h2.2l.22 1.35a4.7 4.7 0 0 1 1.05.6l1.15-.7.95.95-.7 1.15c.26.32.47.67.6 1.05l1.35.22v2.2l-1.35.22a4.7 4.7 0 0 1-.6 1.05l.7 1.15-.95.95-1.15-.7a4.7 4.7 0 0 1-1.05.6l-.22 1.35H6.9l-.22-1.35a4.7 4.7 0 0 1-1.05-.6l-1.15.7-.95-.95.7-1.15a4.7 4.7 0 0 1-.6-1.05l-1.35-.22V6.77l1.35-.22c.13-.38.34-.73.6-1.05l-.7-1.15.95-.95 1.15.7c.32-.26.67-.47 1.05-.6L6.9 1.15zM8 5.65a2.35 2.35 0 1 0 0 4.7 2.35 2.35 0 1 0 0-4.7z',
} as const;

export type IconName = keyof typeof PATHS;

/** A 16px ink icon. */
export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}

/** Square button sized for one icon. */
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
