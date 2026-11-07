import { h } from '../dom/index.js';
import { paint } from '../style.js';
import { border, color } from '../token.js';

export function card(
  doc: Document,
  options: { title: string; hint: string; spaced?: boolean },
  ...body: Node[]
): HTMLElement {
  const heading = h(doc, 'h2', {}, options.title);
  paint(heading, { margin: '0', fontSize: '16px', fontWeight: '400', letterSpacing: '0.07em' });
  const hint = h(doc, 'small', {}, options.hint);
  paint(hint, { color: color.muted, fontSize: '11px' });
  const head = h(doc, 'div', { class: 'card-head' }, heading, hint);
  paint(head, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '12px',
    padding: '15px 17px 12px',
    borderBottom: border.hairline,
  });

  const node = h(
    doc,
    'section',
    { class: options.spaced ? 'card section' : 'card' },
    head,
    ...body,
  );
  paint(node, { minWidth: '0', border: border.hairline, background: 'transparent' });
  if (options.spaced) paint(node, { marginTop: '16px' });
  return node;
}
