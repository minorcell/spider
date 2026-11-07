import { h } from '../dom/index.js';
import { paint } from '../style.js';
import { border, color } from '../token.js';

export function pill(doc: Document, text: string): HTMLElement {
  const node = h(doc, 'span', { class: 'pill' }, text);
  paint(node, {
    display: 'inline-block',
    padding: '2px 6px',
    border: border.hairline,
    color: color.muted,
    fontSize: '10px',
  });
  return node;
}
