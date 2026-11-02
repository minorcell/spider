import { h } from '../dom/index.js';
import { onMedia, paint } from '../style.js';
import { border, color, media } from '../token.js';

export type DialogKind = 'card' | 'sheet';

const NARROW = media.sheet;

function paintSheet(node: HTMLDialogElement, narrow: boolean): void {
  paint(node, {
    border: border.ink,
    background: color.paper,
    color: color.ink,
    width: narrow ? 'calc(100% - 16px)' : 'min(1120px, calc(100% - 32px))',
    height: narrow ? 'calc(100vh - 16px)' : 'min(760px, calc(100vh - 48px))',
    maxHeight: narrow ? 'calc(100vh - 16px)' : 'calc(100vh - 48px)',
    padding: '0',
    overflow: 'hidden',
  });
}

/** Paper dialog. `card` is the small confirm box; `sheet` is the wide settings panel. */
export function markDialog(node: HTMLDialogElement, kind: DialogKind): HTMLDialogElement {
  if (kind === 'card') {
    paint(node, {
      border: border.ink,
      background: color.paper,
      color: color.ink,
      width: 'min(26rem, calc(100% - 32px))',
      padding: '22px 24px',
    });
  } else {
    onMedia(NARROW, (narrow) => paintSheet(node, narrow));
  }
  return node;
}

let backdropReady = false;

function installBackdrop(doc: Document): void {
  if (backdropReady) return;
  backdropReady = true;
  const style = doc.createElement('style');
  style.textContent = `dialog::backdrop{background:${color.veil}}`;
  doc.head.append(style);
}

export function dialog(
  doc: Document,
  options: { id: string; label: string; kind: DialogKind },
): HTMLDialogElement {
  installBackdrop(doc);
  const node = h(doc, 'dialog', { id: options.id, 'aria-label': options.label });
  return markDialog(node, options.kind);
}

export function dialogTitle(doc: Document, text: string): HTMLHeadingElement {
  const title = h(doc, 'h2', {}, text);
  paint(title, {
    margin: '0 0 12px',
    fontSize: '16px',
    fontWeight: 'normal',
    letterSpacing: '0.08em',
  });
  return title;
}

export function dialogActions(doc: Document, ...actions: HTMLButtonElement[]): HTMLElement {
  const menu = h(doc, 'menu', {}, ...actions);
  paint(menu, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    margin: '0',
    padding: '0',
  });
  return menu;
}

/** Open a modal. An open dialog is left as it is. */
export function showDialog(node: HTMLDialogElement): void {
  if (!node.open) node.showModal();
}

/** Close a dialog. A closed dialog is left as it is. */
export function closeDialog(node: HTMLDialogElement): void {
  if (node.open) node.close();
}
