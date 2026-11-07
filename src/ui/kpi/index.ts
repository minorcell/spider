import { h } from '../dom/index.js';
import { onMedia, paint } from '../style.js';
import { border, color, media } from '../token.js';

export type KpiValue = string | Node[];

export function kpi(
  doc: Document,
  options: { label: string; value: KpiValue; foot: string },
): HTMLElement {
  const label = h(doc, 'span', { class: 'kpi-label' }, options.label);
  paint(label, { color: color.muted, fontSize: '12px' });
  const value = h(doc, 'div', { class: 'kpi-value' });
  if (typeof options.value === 'string') value.textContent = options.value;
  else value.append(...options.value);
  paint(value, { marginTop: '13px', fontSize: '28px', letterSpacing: '0.02em' });
  for (const unit of value.querySelectorAll<HTMLElement>('.kpi-unit')) {
    paint(unit, { fontSize: '16px' });
  }
  const foot = h(doc, 'span', { class: 'kpi-foot' }, options.foot);
  paint(foot, { display: 'block', marginTop: '5px', color: color.muted, fontSize: '11px' });
  const node = h(doc, 'article', { class: 'kpi' }, label, value, foot);
  paint(node, { minHeight: '108px', padding: '15px 16px 12px', border: border.hairline });
  return node;
}

export function kpiGrid(
  doc: Document,
  options: { label: string },
  ...cards: HTMLElement[]
): HTMLElement {
  const node = h(doc, 'section', { class: 'kpis', 'aria-label': options.label }, ...cards);
  paint(node, { display: 'grid', gap: '10px', marginBottom: '22px' });
  onMedia(media.sheet, (narrow) => {
    paint(node, {
      gridTemplateColumns: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
    });
  });
  return node;
}
