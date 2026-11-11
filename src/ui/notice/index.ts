import { h } from '@/src/ui/dom';
import { paint } from '@/src/ui/style';
import { border, color, panelStyle } from '@/src/ui/token';

export function notice(doc: Document, options: { label: string; text: string }): HTMLElement {
  const label = h(doc, 'b', {}, options.label);
  paint(label, { flex: '0 0 auto', fontWeight: '650', color: color.accent });
  const node = h(doc, 'p', { class: 'notice' }, label, options.text);
  paint(node, {
    ...panelStyle,
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    margin: '0 0 22px',
    padding: '11px 13px',
    borderLeft: border.focus,
    background: color.paperDeep,
    color: color.ink,
    fontSize: '13px',
    lineHeight: '1.5',
  });
  return node;
}
