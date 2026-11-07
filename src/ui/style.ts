import { border } from './token.js';

export function paint(node: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(node.style, style);
}

export function onMedia(query: string, apply: (matches: boolean) => void): void {
  if (typeof window.matchMedia !== 'function') {
    apply(false);
    return;
  }
  const list = window.matchMedia(query);
  const run = (): void => apply(list.matches);
  run();
  list.addEventListener('change', run);
}

export function bindFocus(node: HTMLElement): void {
  node.addEventListener('focus', () => {
    node.style.outline = border.ink;
    node.style.outlineOffset = '2px';
  });
  node.addEventListener('blur', () => {
    node.style.outline = '';
    node.style.outlineOffset = '';
  });
}
