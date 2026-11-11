import { h } from '@/src/ui/dom';
import { onMedia, paint } from '@/src/ui/style';
import { color, media, panelStyle } from '@/src/ui/token';

export type DialogKind = 'card' | 'sheet';

const NARROW = media.sheet;

function paintSheet(node: HTMLDialogElement, narrow: boolean): void {
  paint(node, {
    width: narrow ? 'calc(100% - 16px)' : 'min(980px, calc(100% - 32px))',
    height: narrow ? 'calc(100vh - 16px)' : 'min(760px, calc(100vh - 48px))',
    maxHeight: narrow ? 'calc(100vh - 16px)' : 'calc(100vh - 48px)',
    padding: '0',
    overflow: 'hidden',
  });
}

export function markDialog(node: HTMLDialogElement, kind: DialogKind): HTMLDialogElement {
  paint(node, {
    ...panelStyle,
    boxSizing: 'border-box',
    color: color.ink,
    boxShadow: '0 14px 54px #080d0bbf',
  });
  if (kind === 'card') {
    paint(node, {
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
    fontWeight: '700',
  });
  return title;
}

export function dialogActions(doc: Document, ...actions: HTMLButtonElement[]): HTMLElement {
  const menu = h(doc, 'menu', {}, ...actions);
  paint(menu, {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: '8px',
    margin: '0',
    padding: '0',
  });
  return menu;
}

export function showDialog(node: HTMLDialogElement): void {
  if (!node.open) node.showModal();
}

export function closeDialog(node: HTMLDialogElement): void {
  if (node.open) node.close();
}
