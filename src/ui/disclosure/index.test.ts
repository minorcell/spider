import { describe, expect, it, vi } from 'vitest';
import { disclosure } from './index.js';

describe('disclosure', () => {
  it('builds its body once when first opened and turns the chevron', () => {
    const body = document.createElement('div');
    const render = vi.fn(() => body);
    const node = disclosure(document, {
      className: 'request',
      summary: document.createElement('summary'),
      render,
    });

    expect(node.className).toBe('request');
    expect(node.open).toBe(false);
    const chevron = node.querySelector<HTMLElement>('.chevron')!;
    expect(node.querySelector('summary .chevron')).toBe(chevron);
    expect(chevron.textContent).toBe('›');
    expect(chevron.style.transform).toBe('');
    expect(render).not.toHaveBeenCalled();

    node.open = true;
    node.dispatchEvent(new Event('toggle'));
    expect(chevron.style.transform).toBe('rotate(90deg)');
    expect(render).toHaveBeenCalledTimes(1);
    expect(node.contains(body)).toBe(true);

    node.dispatchEvent(new Event('toggle'));
    expect(render).toHaveBeenCalledTimes(1);

    node.open = false;
    node.dispatchEvent(new Event('toggle'));
    expect(chevron.style.transform).toBe('');
    expect(render).toHaveBeenCalledTimes(1);
  });
});
