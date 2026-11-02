import { describe, expect, it, vi } from 'vitest';
import { menuSelect, type MenuSelect } from './index.js';

function inputOf(root: ParentNode): MenuSelect {
  return root.querySelector('input') as MenuSelect;
}

describe('menuSelect', () => {
  it('opens, chooses a listed value, and ignores a click on the menu itself', () => {
    const onChange = vi.fn();
    const root = menuSelect(document, {
      name: 'date',
      placeholder: '还没有日记',
      choices: [
        { value: '2026-11-01', label: '2026-11-01 昨天' },
        { value: '2026-11-02', label: '2026-11-02 今天' },
      ],
      value: '2026-11-02',
    });
    document.body.append(root);
    const input = inputOf(root);
    input.addEventListener('change', onChange);
    const trigger = root.querySelector<HTMLButtonElement>('.select-trigger')!;
    expect(trigger.textContent).toContain('今天');
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    root.querySelector('.select-menu')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-value="2026-11-01"]')!.click();
    expect(input.value).toBe('2026-11-01');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    trigger.click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    root.remove();
  });

  it('drops an unknown choice and can start empty', () => {
    const root = menuSelect(document, { name: 'date', menuId: 'date-menu', buttonClass: 'extra' });
    const input = inputOf(root);
    expect(input.value).toBe('');
    expect(root.querySelector('.extra')!.textContent).toBe('⌄');
    input.setChoices([{ value: '2026-11-02', label: '今天' }]);
    expect(input.value).toBe('');
    input.value = '2026-11-02';
    expect(root.querySelector('.select-value')!.textContent).toBe('今天');
    const menu = root.querySelector('#date-menu')!;
    const bogus = document.createElement('button');
    bogus.setAttribute('role', 'option');
    bogus.dataset.value = 'nope';
    menu.append(bogus);
    bogus.click();
    expect(input.value).toBe('2026-11-02');
    const option = menu.querySelector<HTMLButtonElement>('[data-value="2026-11-02"]')!;
    option.dispatchEvent(new MouseEvent('mouseenter'));
    option.dispatchEvent(new MouseEvent('mouseleave'));
    expect(option.style.outline).toContain('1px');
    input.setChoices([
      { value: '2026-11-02', label: '今天' },
      { value: '2026-11-03', label: '明天' },
    ]);
    expect(input.value).toBe('2026-11-02');
    const other = menu.querySelector<HTMLButtonElement>('[data-value="2026-11-03"]')!;
    other.dispatchEvent(new MouseEvent('mouseenter'));
    other.dispatchEvent(new MouseEvent('mouseleave'));
    expect(other.style.outline).toBe('');
    const plain = document.createElement('button');
    plain.setAttribute('role', 'option');
    menu.append(plain);
    plain.dispatchEvent(new MouseEvent('mouseenter'));
    plain.dispatchEvent(new MouseEvent('mouseleave'));
    expect(plain.style.outline).toBe('');
    plain.click();
    expect(input.value).toBe('2026-11-02');
  });
});
