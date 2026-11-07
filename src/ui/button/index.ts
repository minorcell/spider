import { h } from '../dom/index.js';
import { bindFocus, onMedia, paint } from '../style.js';
import { border, color, media } from '../token.js';

export type ButtonVariant = 'solid' | 'ghost' | 'quiet';

const NARROW = media.sheet;

function paintQuiet(node: HTMLButtonElement, narrow: boolean): void {
  const current = node.getAttribute('aria-current') === 'page';
  paint(node, {
    border: '0',
    borderLeft: narrow ? '0' : `2px solid ${current ? color.ink : 'transparent'}`,
    borderBottom: narrow ? `2px solid ${current ? color.ink : 'transparent'}` : '0',
    padding: '9px 10px',
    background: 'transparent',
    color: current ? color.ink : color.muted,
    fontWeight: current ? '600' : '400',
    textAlign: narrow ? 'center' : 'left',
    cursor: 'pointer',
  });
}

export function button(
  doc: Document,
  label: string,
  options: {
    variant?: ButtonVariant;
    type?: 'button' | 'submit';
    id?: string;
    pressed?: boolean;
  } = {},
): HTMLButtonElement {
  const variant = options.variant ?? 'solid';
  const node = h(
    doc,
    'button',
    {
      type: options.type ?? 'button',
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.pressed === undefined
        ? {}
        : { 'aria-pressed': options.pressed ? 'true' : 'false' }),
    },
    label,
  );
  paint(node, {
    font: 'inherit',
    letterSpacing: 'inherit',
    cursor: 'pointer',
  });
  bindFocus(node);
  if (variant === 'ghost') {
    paint(node, {
      border: border.hairline,
      padding: '7px 12px',
      background: 'transparent',
      color: color.ink,
    });
    node.addEventListener('mouseenter', () => {
      node.style.borderColor = color.ink;
    });
    node.addEventListener('mouseleave', () => {
      node.style.borderColor = color.hairline;
    });
  } else if (variant === 'quiet') {
    let narrow = false;
    onMedia(NARROW, (matches) => {
      narrow = matches;
      paintQuiet(node, narrow);
    });
    node.addEventListener('mouseenter', () => {
      node.style.color = color.ink;
    });
    node.addEventListener('mouseleave', () => paintQuiet(node, narrow));
    new MutationObserver(() => paintQuiet(node, narrow)).observe(node, {
      attributes: true,
      attributeFilter: ['aria-current'],
    });
  } else {
    const paintSolid = (): void => {
      const on = node.getAttribute('aria-pressed') === 'true';
      paint(node, {
        border: border.ink,
        background: on ? color.ink : color.paper,
        color: on ? color.paper : color.ink,
        padding: '0 0.55em',
      });
    };
    paintSolid();
    if (options.pressed !== undefined) {
      new MutationObserver(paintSolid).observe(node, {
        attributes: true,
        attributeFilter: ['aria-pressed'],
      });
    }
  }
  return node;
}
