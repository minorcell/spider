import { h } from '@/src/ui/dom';
import { bindFocus, onMedia, paint } from '@/src/ui/style';
import { border, color, controlStyle, media } from '@/src/ui/token';

export type ButtonVariant = 'solid' | 'primary' | 'ghost' | 'quiet';

const NARROW = media.sheet;

function paintQuiet(node: HTMLButtonElement, narrow: boolean): void {
  const current = node.getAttribute('aria-current') === 'page';
  paint(node, {
    border: '0',
    borderLeft: narrow ? '0' : `2px solid ${current ? color.accent : 'transparent'}`,
    borderBottom: narrow ? `2px solid ${current ? color.accent : 'transparent'}` : '0',
    padding: '9px 10px',
    background: current ? color.selected : 'transparent',
    color: current ? color.accent : color.muted,
    fontWeight: current ? '600' : '400',
    justifyContent: narrow ? 'center' : 'flex-start',
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
      class: 'ui-button',
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.pressed === undefined
        ? {}
        : { 'aria-pressed': options.pressed ? 'true' : 'false' }),
    },
    label,
  );
  paint(node, {
    ...controlStyle,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: 'inherit',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  });
  bindFocus(node);
  if (variant === 'ghost') {
    paint(node, {
      border: border.hairline,
      padding: '6px 12px',
      background: 'transparent',
      color: color.ink,
    });
    node.addEventListener('mouseenter', () => {
      node.style.borderColor = color.accent;
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
      const primary = variant === 'primary';
      paint(node, {
        border: primary || on ? border.focus : border.hairline,
        background: primary ? color.accent : on ? color.selected : color.control,
        color: primary ? color.onAccent : on ? color.accent : color.ink,
        padding: '6px 13px',
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
