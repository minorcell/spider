import { describe, expect, it } from 'vitest';
import { h } from './index.js';

describe('h', () => {
  it('sets class, hidden, and attributes, and skips undefined', () => {
    const child = h(document, 'span', {}, '内文');
    const node = h(
      document,
      'button',
      { class: 'ui-button', hidden: false, type: 'button', id: undefined },
      child,
    );
    expect(node.className).toBe('ui-button');
    expect(node.hidden).toBe(false);
    expect(node.getAttribute('type')).toBe('button');
    expect(node.hasAttribute('id')).toBe(false);
    expect(node.firstChild).toBe(child);
    expect(h(document, 'p', { hidden: true }).hidden).toBe(true);
  });
});
