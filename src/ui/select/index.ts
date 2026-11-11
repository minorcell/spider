import { h } from '@/src/ui/dom';
import { bindFocus, paint } from '@/src/ui/style';
import { border, color, controlStyle, font, panelStyle } from '@/src/ui/token';

export type SelectChoice = { value: string; label: string };

export type MenuSelect = HTMLInputElement & {
  setChoices(choices: SelectChoice[]): void;
};

export function menuSelect(
  doc: Document,
  options: {
    name: string;
    choices?: SelectChoice[];
    value?: string;
    placeholder?: string;
    menuId?: string;
    buttonClass?: string;
  },
): HTMLElement {
  const choices: SelectChoice[] = [];
  const input = h(doc, 'input', { type: 'hidden', name: options.name }) as MenuSelect;
  const valueText = h(doc, 'span', { class: 'select-value' });
  const trigger = h(
    doc,
    'button',
    {
      type: 'button',
      class: options.buttonClass ?? 'select-trigger',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      ...(options.menuId ? { 'aria-controls': options.menuId } : {}),
    },
    valueText,
    h(doc, 'span', { class: 'select-arrow', 'aria-hidden': 'true' }, '⌄'),
  );
  const menu = h(doc, 'div', {
    class: 'select-menu',
    role: 'listbox',
    hidden: true,
    ...(options.menuId ? { id: options.menuId } : {}),
  });
  const wrap = h(doc, 'div', { class: 'select-wrap' }, input, trigger, menu);

  const paintTrigger = (): void => {
    paint(trigger, {
      ...controlStyle,
      width: '100%',
      minWidth: '112px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '14px',
      padding: '6px 10px',
      font: font.body,
      cursor: 'pointer',
      textAlign: 'left',
    });
    paint(menu, {
      ...panelStyle,
      position: 'absolute',
      top: 'calc(100% + 5px)',
      right: '0',
      zIndex: '5',
      minWidth: '100%',
      margin: '0',
      padding: '4px',
      boxShadow: '0 8px 24px #080d0b9c',
    });
    paint(wrap, { position: 'relative' });
  };

  const labelFor = (value: string): string =>
    choices.find((choice) => choice.value === value)?.label ?? (value || options.placeholder || '');

  const paintValue = (): void => {
    valueText.textContent = labelFor(input.value);
    for (const option of menu.querySelectorAll<HTMLElement>('[role="option"]')) {
      const selected = option.dataset.value === input.value;
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
      option.style.outline = selected ? border.focus : '';
      option.style.outlineOffset = selected ? '-1px' : '';
      option.style.background = selected ? color.selected : 'transparent';
    }
  };
  const valueProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() {
      return valueProp.get!.call(this) as string;
    },
    set(next: string) {
      valueProp.set!.call(this, next);
      paintValue();
    },
  });

  const setOpen = (open: boolean): void => {
    trigger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    trigger.style.outline = open ? border.focus : '';
    trigger.style.outlineOffset = open ? '2px' : '';
  };

  const choose = (value: string): void => {
    if (!choices.some((choice) => choice.value === value)) {
      setOpen(false);
      return;
    }
    input.value = value;
    paintValue();
    setOpen(false);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  input.setChoices = (next) => {
    choices.splice(0, choices.length, ...next);
    menu.replaceChildren(
      ...choices.map((choice) => {
        const option = h(
          doc,
          'button',
          {
            type: 'button',
            role: 'option',
            'data-value': choice.value,
            'aria-selected': choice.value === input.value ? 'true' : 'false',
          },
          choice.label,
        );
        paint(option, {
          display: 'block',
          width: '100%',
          border: '0',
          borderRadius: '4px',
          padding: '6px 8px',
          background: 'transparent',
          color: color.ink,
          font: font.body,
          textAlign: 'left',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        });
        option.addEventListener('mouseenter', () => {
          option.style.outline = border.focus;
          option.style.outlineOffset = '-1px';
        });
        option.addEventListener('mouseleave', () => {
          if (option.getAttribute('aria-selected') !== 'true') option.style.outline = '';
        });
        if (choice.value === input.value) {
          option.style.outline = border.focus;
          option.style.outlineOffset = '-1px';
        }
        return option;
      }),
    );
    if (!choices.some((choice) => choice.value === input.value)) input.value = '';
    paintValue();
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(trigger.getAttribute('aria-expanded') !== 'true');
  });
  menu.addEventListener('click', (event) => {
    const option = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      '[role="option"]',
    );
    if (!option) return;
    choose(option.dataset.value ?? '');
  });
  doc.addEventListener('click', (event) => {
    if (!(event.target instanceof Node) || !wrap.isConnected) return;
    if (wrap.contains(event.target)) return;
    setOpen(false);
  });
  bindFocus(trigger);
  paintTrigger();
  if (options.value !== undefined) input.value = options.value;
  input.setChoices(options.choices ?? []);
  paintValue();
  return wrap;
}
