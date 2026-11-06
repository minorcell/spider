import { describe, expect, it } from 'vitest';
import { pill } from './index.js';

describe('pill', () => {
  it('wraps a short label in an outline', () => {
    const node = pill(document, '没有工具调用');
    expect(node.className).toBe('pill');
    expect(node.textContent).toBe('没有工具调用');
    expect(node.style.display).toBe('inline-block');
    expect(node.style.border).toContain('var(--ui-hairline)');
  });
});
