import { h } from '../dom/index.js';
import { bindFocus, paint } from '../style.js';
import { border, color } from '../token.js';

const thumbs = new WeakMap<HTMLInputElement, HTMLElement>();

function placeThumb(input: HTMLInputElement, thumb: HTMLElement): void {
  paint(thumb, {
    left: input.checked ? 'auto' : '2px',
    right: input.checked ? '2px' : 'auto',
    background: input.checked ? color.ink : 'transparent',
  });
}

/** Move the thumb after `checked` is set by code, which fires no change event. */
export function reflectSwitch(input: HTMLInputElement): void {
  const thumb = thumbs.get(input);
  if (thumb) placeThumb(input, thumb);
}

/**
 * Turn a label's checkbox into a switch. The input keeps its name, so a form
 * can still read it. Calling this twice does not add a second track.
 */
export function enhanceSwitch(label: HTMLLabelElement): HTMLLabelElement {
  const input = label.querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('A switch needs a checkbox');
  if (label.querySelector('.ui-switch-track')) return label;
  label.classList.add('ui-switch');
  input.classList.add('ui-switch-input');
  input.setAttribute('role', 'switch');
  paint(label, {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  });
  paint(input, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '0',
    padding: '0',
    border: '0',
    opacity: '0',
  });
  const track = label.ownerDocument.createElement('span');
  track.className = 'ui-switch-track';
  track.setAttribute('aria-hidden', 'true');
  paint(track, {
    boxSizing: 'border-box',
    width: '2.6em',
    height: '1.35em',
    border: border.ink,
    position: 'relative',
    flex: 'none',
  });
  const thumb = label.ownerDocument.createElement('span');
  paint(thumb, {
    position: 'absolute',
    top: '2px',
    width: '0.85em',
    height: 'calc(1.35em - 6px)',
    border: border.ink,
  });
  track.append(thumb);
  input.after(track);
  thumbs.set(input, thumb);
  placeThumb(input, thumb);
  input.addEventListener('change', () => placeThumb(input, thumb));
  bindFocus(input);
  input.addEventListener('focus', () => {
    track.style.outline = border.ink;
    track.style.outlineOffset = '2px';
  });
  input.addEventListener('blur', () => {
    track.style.outline = '';
    track.style.outlineOffset = '';
  });
  return label;
}

/** A labeled switch. `checked` is the initial position; later changes stay on the input. */
export function switchField(
  doc: Document,
  options: { name: string; label: string; checked?: boolean },
): HTMLLabelElement {
  const input = h(doc, 'input', { type: 'checkbox', name: options.name });
  input.checked = options.checked === true;
  const label = h(doc, 'label', { class: 'check' }, input, options.label);
  return enhanceSwitch(label);
}
