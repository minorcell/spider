import { afterEach, describe, expect, it, vi } from 'vitest';
import { button } from '../button/index.js';
import { closeDialog, dialog, dialogActions, dialogTitle, showDialog } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dialog', () => {
  it('marks a card and lays out its title and actions', () => {
    const card = dialog(document, { id: 'leave', label: '离开', kind: 'card' });
    const title = dialogTitle(document, '要在离开前记一笔吗');
    const menu = dialogActions(document, button(document, '确定关闭'), button(document, '总结'));
    card.append(title, menu);
    expect(card.id).toBe('leave');
    expect(card.style.width).toContain('26rem');
    expect(title.style.fontSize).toBe('16px');
    expect(menu.style.display).toBe('flex');
  });

  it('shrinks a sheet when the viewport is narrow', () => {
    let matches = false;
    const listeners: Array<() => void> = [];
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches;
      },
      addEventListener(_type: string, listener: () => void) {
        listeners.push(listener);
      },
    }));
    const sheet = dialog(document, { id: 'settings', label: '设置', kind: 'sheet' });
    expect(sheet.style.width).toContain('1120px');
    matches = true;
    for (const listener of listeners) listener();
    expect(sheet.style.width).toBe('calc(100% - 16px)');
    expect(sheet.style.height).toBe('calc(100vh - 16px)');
  });

  it('opens once and closes once', () => {
    const node = document.createElement('dialog');
    document.body.append(node);
    showDialog(node);
    showDialog(node);
    expect(node.open).toBe(true);
    closeDialog(node);
    closeDialog(node);
    expect(node.open).toBe(false);
    node.remove();
  });
});
