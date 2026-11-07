import { h } from '../dom/index.js';
import { paint } from '../style.js';
import { color } from '../token.js';

export function disclosure(
  doc: Document,
  options: {
    className: string;
    summary: HTMLElement;
    render: () => Node;
  },
): HTMLDetailsElement {
  const details = h(doc, 'details', { class: options.className });
  const chevron = h(doc, 'span', { class: 'chevron' }, '›');
  paint(chevron, { color: color.muted, transition: 'transform 0.2s' });
  options.summary.append(chevron);
  details.append(options.summary);

  let filled = false;
  details.addEventListener('toggle', () => {
    const open = details.open;
    chevron.style.transform = open ? 'rotate(90deg)' : '';
    if (!open || filled) return;
    filled = true;
    details.append(options.render());
  });
  return details;
}
