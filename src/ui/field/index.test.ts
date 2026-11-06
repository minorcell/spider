import { describe, expect, it } from 'vitest';
import { field } from './index.js';

describe('field', () => {
  it('builds a text input by default and a number input with bounds', () => {
    const text = field(document, {
      label: 'Model ID',
      name: 'model',
      placeholder: 'deepseek-chat',
      id: 'model',
    });
    const input = text.querySelector('input');
    expect(text.style.display).toBe('grid');
    expect(input?.type).toBe('text');
    expect(input?.name).toBe('model');
    expect(input?.id).toBe('model');
    expect(input?.getAttribute('placeholder')).toBe('deepseek-chat');
    expect(input?.hasAttribute('min')).toBe(false);
    expect(input?.style.border).toBe('1px solid var(--ui-ink)');

    const number = field(document, {
      label: '上下文长度 k token',
      name: 'contextTokens',
      kind: 'number',
      min: 1,
      step: 1,
      autocomplete: 'off',
      spellcheck: false,
    });
    const box = number.querySelector('input');
    expect(box?.type).toBe('number');
    expect(box?.getAttribute('min')).toBe('1');
    expect(box?.getAttribute('step')).toBe('1');
    expect(box?.getAttribute('spellcheck')).toBe('false');
  });

  it('builds a textarea and a select', () => {
    const area = field(document, { label: '摘要', name: 'summary', kind: 'textarea', rows: 5 });
    expect(area.querySelector('textarea')?.getAttribute('rows')).toBe('5');
    const fallback = field(document, { label: '记下的', name: 'noted', kind: 'textarea' });
    expect(fallback.querySelector('textarea')?.getAttribute('rows')).toBe('4');
  });
});
