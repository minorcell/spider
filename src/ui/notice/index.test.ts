import { describe, expect, it } from 'vitest';
import { notice } from './index.js';

describe('notice', () => {
  it('marks the label and reads as one aside', () => {
    const node = notice(document, { label: '统计口径', text: '旧记录按总量推算。' });
    expect(node.className).toBe('notice');
    expect(node.querySelector('b')?.textContent).toBe('统计口径');
    expect(node.textContent).toContain('旧记录按总量推算。');
    expect(node.style.display).toBe('flex');
  });
});
