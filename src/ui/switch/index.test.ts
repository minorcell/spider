import { describe, expect, it } from 'vitest';
import { enhanceSwitch, reflectSwitch, switchField } from './index.js';

describe('switch', () => {
  it('enhances a checkbox once and moves the thumb when it changes', () => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'compact';
    label.append(input, '自动压缩');
    enhanceSwitch(label);
    enhanceSwitch(label);
    const thumb = label.querySelector('.ui-switch-track span') as HTMLElement;
    expect(input.getAttribute('role')).toBe('switch');
    expect(label.querySelectorAll('.ui-switch-track')).toHaveLength(1);
    expect(thumb.style.backgroundColor).toBe('transparent');
    input.checked = true;
    reflectSwitch(input);
    expect(thumb.style.backgroundColor).toBe('rgb(27, 23, 20)');
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(thumb.style.backgroundColor).toBe('transparent');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(thumb.style.backgroundColor).toBe('rgb(27, 23, 20)');
    input.dispatchEvent(new FocusEvent('focus'));
    expect(label.querySelector<HTMLElement>('.ui-switch-track')!.style.outline).toBe(
      '1px solid #1b1714',
    );
    input.dispatchEvent(new FocusEvent('blur'));
    expect(label.querySelector<HTMLElement>('.ui-switch-track')!.style.outline).toBe('');
  });

  it('refuses a label without a checkbox', () => {
    expect(() => enhanceSwitch(document.createElement('label'))).toThrow(
      'A switch needs a checkbox',
    );
    reflectSwitch(document.createElement('input'));
  });

  it('builds a named switch that can start on or off', () => {
    const on = switchField(document, { name: 'autoMemory', label: '自动记忆', checked: true });
    const off = switchField(document, { name: 'compact', label: '自动压缩', checked: false });
    const onInput = on.querySelector('input') as HTMLInputElement;
    const offInput = off.querySelector('input') as HTMLInputElement;
    expect(onInput.name).toBe('autoMemory');
    expect(onInput.checked).toBe(true);
    expect(on.textContent).toContain('自动记忆');
    expect((on.querySelector('.ui-switch-track span') as HTMLElement).style.backgroundColor).toBe(
      'rgb(27, 23, 20)',
    );
    expect(offInput.checked).toBe(false);
    expect(off.querySelector('.ui-switch-track')).not.toBeNull();
  });
});
