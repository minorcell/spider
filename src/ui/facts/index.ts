import { h } from '../dom/index.js';
import { onMedia, paint } from '../style.js';
import { color, media } from '../token.js';

export interface Fact {
  label: string;
  value: Node | string;
}

export function facts(
  doc: Document,
  options: { className?: string; inset?: boolean },
  fields: Fact[],
  ...extra: Node[]
): HTMLElement {
  const node = h(doc, 'div', { class: options.className ?? 'facts' });
  for (const field of fields) {
    const label = h(doc, 'strong', {}, field.label);
    paint(label, { display: 'block', marginBottom: '4px', color: color.ink, fontWeight: '400' });
    node.append(h(doc, 'div', {}, label, field.value));
  }
  if (extra.length > 0) {
    const tail = h(doc, 'div', { class: 'facts-extra' }, ...extra);
    paint(tail, { gridColumn: '1/-1', display: 'flex', flexWrap: 'wrap', gap: '5px' });
    node.append(tail);
  }
  onMedia(media.phone, (phone) => {
    paint(node, {
      display: 'grid',
      gridTemplateColumns: phone ? '1fr' : 'repeat(3, 1fr)',
      gap: '14px',
      padding: phone ? '0 15px 15px' : options.inset ? '0 15px 15px 103px' : '0 15px 15px',
      color: color.muted,
      fontSize: '11px',
    });
  });
  return node;
}
