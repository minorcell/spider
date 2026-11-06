import { describe, expect, it } from 'vitest';
import { card } from './index.js';

describe('card', () => {
  it('builds a titled section and adds the spaced rule only when asked', () => {
    const body = document.createElement('div');
    const plain = card(document, { title: '按模型', hint: '精确值' }, body);
    expect(plain.className).toBe('card');
    expect(plain.querySelector('.card-head h2')?.textContent).toBe('按模型');
    expect(plain.querySelector('.card-head small')?.textContent).toBe('精确值');
    expect(plain.contains(body)).toBe(true);
    expect(plain.style.marginTop).toBe('');

    const spaced = card(document, { title: '请求明细', hint: '点击展开', spaced: true });
    expect(spaced.className).toBe('card section');
    expect(spaced.style.marginTop).toBe('16px');
    expect(spaced.style.border).toContain('var(--ui-hairline)');
  });
});
