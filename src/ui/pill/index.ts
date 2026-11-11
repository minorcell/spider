import { h } from '@/src/ui/dom';
import { paint } from '@/src/ui/style';
import { border, color } from '@/src/ui/token';

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
