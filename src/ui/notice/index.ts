import { h } from '../dom/index.js';
import { paint } from '../style.js';
import { border, color } from '../token.js';

export function notice(doc: Document, options: { label: string; text: string }): HTMLElement {
  const label = h(doc, 'b', {}, options.label);
  paint(label, { flex: '0 0 auto', fontWeight: '500' });
  const node = h(doc, 'p', { class: 'notice' }, label, options.text);
  paint(node, {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    margin: '0 0 22px',
    padding: '11px 13px',
    border: border.hairline,
    color: color.ink,
    fontSize: '13px',
    lineHeight: '1.5',
  });
  return node;
}
