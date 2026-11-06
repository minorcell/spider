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
    expect(plain.style.background).toBe('var(--ui-paper)');

    const pressed = button(document, '观察', { pressed: true });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    expect(pressed.style.background).toBe('var(--ui-ink)');

    const node = button(document, '观察', { id: 'observe-open', pressed: false });
    document.body.append(node);
    expect(node.id).toBe('observe-open');
    expect(node.getAttribute('aria-pressed')).toBe('false');
    expect(node.style.background).toBe('var(--ui-paper)');
    node.setAttribute('aria-pressed', 'true');
    await Promise.resolve();
    expect(node.style.background).toBe('var(--ui-ink)');
    expect(node.style.color).toBe('var(--ui-paper)');
    node.remove();
  });

  it('darkens a ghost button while the pointer is over it', () => {
    const node = button(document, '导出', { variant: 'ghost', type: 'submit', id: 'usage-export' });
    expect(node.type).toBe('submit');
    expect(node.style.background).toBe('transparent');
    node.dispatchEvent(new MouseEvent('mouseenter'));
    expect(node.style.borderColor).toBe('var(--ui-ink)');
    node.dispatchEvent(new MouseEvent('mouseleave'));
    expect(node.style.borderColor).toBe('var(--ui-hairline)');
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
    expect(node.style.borderLeft).toContain('2px');
    expect(node.style.textAlign).toBe('left');
    node.dispatchEvent(new MouseEvent('mouseenter'));
    expect(node.style.color).toBe('var(--ui-ink)');
    node.dispatchEvent(new MouseEvent('mouseleave'));
    expect(node.style.color).toBe('var(--ui-muted)');

    node.setAttribute('aria-current', 'page');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(node.style.fontWeight).toBe('600');
    expect(node.style.borderLeft).toContain('2px');
    node.removeAttribute('aria-current');
    await new Promise((resolve) => setTimeout(resolve, 0));

    matches = true;
    for (const listener of listeners) listener();
    expect(node.style.borderBottom).toContain('2px');
    expect(node.style.textAlign).toBe('center');
    expect(node.style.color).toBe('var(--ui-muted)');
    node.setAttribute('aria-current', 'page');
    await new Promise((resolve) => setTimeout(resolve, 0));
    node.dispatchEvent(new MouseEvent('mouseleave'));
    expect(node.style.color).toBe('var(--ui-ink)');
    node.remove();
  });
});
