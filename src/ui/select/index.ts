import { h } from '../dom/index.js';
import { bindFocus, paint } from '../style.js';
import { border, color, font } from '../token.js';

export type SelectChoice = { value: string; label: string };

export type MenuSelect = HTMLInputElement & {
  setChoices(choices: SelectChoice[]): void;
};

/** A labeled listbox. The named input keeps the value for the form and fires `change`. */
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
      minWidth: '112px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '14px',
      border: border.ink,
      padding: '7px 9px',
      background: color.paper,
      color: color.ink,
      font: font.body,
      cursor: 'pointer',
      textAlign: 'left',
    });
    paint(menu, {
      position: 'absolute',
      top: 'calc(100% + 5px)',
      right: '0',
      zIndex: '5',
      minWidth: '100%',
      margin: '0',
      padding: '4px',
      border: border.ink,
      background: color.paper,
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
      option.style.outline = selected ? border.ink : '';
      option.style.outlineOffset = selected ? '-1px' : '';
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
    trigger.style.outline = open ? border.ink : '';
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
          padding: '6px 8px',
          background: 'transparent',
          color: color.ink,
          font: font.body,
          textAlign: 'left',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        });
        option.addEventListener('mouseenter', () => {
          option.style.outline = border.ink;
          option.style.outlineOffset = '-1px';
        });
        option.addEventListener('mouseleave', () => {
          if (option.getAttribute('aria-selected') !== 'true') option.style.outline = '';
        });
        if (choice.value === input.value) {
          option.style.outline = border.ink;
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
    /* v8 ignore next */
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
