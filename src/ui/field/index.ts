import { h } from '@/src/ui/dom';
import { bindFocus, paint } from '@/src/ui/style';
import { color, controlStyle } from '@/src/ui/token';

export type FieldKind = 'text' | 'url' | 'password' | 'number' | 'textarea';

export function fieldGrid(doc: Document, ...fields: HTMLLabelElement[]): HTMLElement {
  const grid = h(doc, 'div', {}, ...fields);
  paint(grid, {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    columnGap: '14px',
  });
  return grid;
}

function paintControl(node: HTMLElement): void {
  paint(node, {
    ...controlStyle,
    width: '100%',
    background: color.paperDeep,
    font: 'inherit',
    padding: '7px 10px',
  });
  bindFocus(node);
}

export function field(
  doc: Document,
  options: {
    label: string;
    name: string;
    kind?: FieldKind;
    placeholder?: string;
    rows?: number;
    autocomplete?: string;
    spellcheck?: boolean;
    min?: number;
    step?: number;
    id?: string;
  },
): HTMLLabelElement {
  const kind = options.kind ?? 'text';
  const shared = {
    name: options.name,
    id: options.id,
    placeholder: options.placeholder,
    autocomplete: options.autocomplete,
    spellcheck: options.spellcheck === undefined ? undefined : String(options.spellcheck),
  };
  const control =
    kind === 'textarea'
      ? h(doc, 'textarea', { ...shared, rows: String(options.rows ?? 4) })
      : h(doc, 'input', {
          ...shared,
          type: kind,
          min: options.min === undefined ? undefined : String(options.min),
          step: options.step === undefined ? undefined : String(options.step),
        });
  paintControl(control);
  const label = h(doc, 'label', {}, options.label, control);
  paint(label, { display: 'grid', gap: '6px', margin: '0 0 14px', color: color.muted });
  return label;
}
