import { afterEach, describe, expect, it, vi } from 'vitest';
import { button } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('button', () => {
  it('builds a solid button and flips when it is pressed', async () => {
    const plain = button(document, '保存');
    expect(plain.textContent).toBe('保存');
    expect(plain.type).toBe('button');
    expect(plain.hasAttribute('id')).toBe(false);
    expect(plain.style.backgroundColor).toBe('rgb(243, 239, 230)');

    const pressed = button(document, '观察', { pressed: true });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    expect(pressed.style.backgroundColor).toBe('rgb(27, 23, 20)');

    const node = button(document, '观察', { id: 'observe-open', pressed: false });
    document.body.append(node);
    expect(node.id).toBe('observe-open');
    expect(node.getAttribute('aria-pressed')).toBe('false');
    expect(node.style.backgroundColor).toBe('rgb(243, 239, 230)');
    node.setAttribute('aria-pressed', 'true');
    await Promise.resolve();
    expect(node.style.backgroundColor).toBe('rgb(27, 23, 20)');
    expect(node.style.color).toBe('rgb(243, 239, 230)');
    node.remove();
  });

  it('darkens a ghost button while the pointer is over it', () => {
    const node = button(document, '导出', { variant: 'ghost', type: 'submit', id: 'usage-export' });
    expect(node.type).toBe('submit');
    expect(node.style.backgroundColor).toBe('transparent');
    node.dispatchEvent(new MouseEvent('mouseenter'));
    expect(node.style.borderColor).toBe('rgb(27, 23, 20)');
    node.dispatchEvent(new MouseEvent('mouseleave'));
    expect(node.style.borderColor).toBe('rgba(27, 23, 20, 0.18)');
  });

  it('paints a quiet button for wide and narrow viewports', async () => {
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
    const node = button(document, '模型', { variant: 'quiet' });
    document.body.append(node);
    expect(node.style.borderLeftWidth).toBe('2px');
    expect(node.style.textAlign).toBe('left');
    node.dispatchEvent(new MouseEvent('mouseenter'));
    expect(node.style.color).toBe('rgb(27, 23, 20)');
    node.dispatchEvent(new MouseEvent('mouseleave'));
    expect(node.style.color).toBe('rgba(27, 23, 20, 0.62)');

    node.setAttribute('aria-current', 'page');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(node.style.fontWeight).toBe('600');
    expect(node.style.borderLeftWidth).toBe('2px');
    node.removeAttribute('aria-current');
    await new Promise((resolve) => setTimeout(resolve, 0));

    matches = true;
    for (const listener of listeners) listener();
    expect(node.style.borderBottomWidth).toBe('2px');
    expect(node.style.textAlign).toBe('center');
    expect(node.style.color).toBe('rgba(27, 23, 20, 0.62)');
    node.setAttribute('aria-current', 'page');
    await new Promise((resolve) => setTimeout(resolve, 0));
    node.dispatchEvent(new MouseEvent('mouseleave'));
    expect(node.style.color).toBe('rgb(27, 23, 20)');
    node.remove();
  });
});
