import { h } from '../dom/index.js';
import { bindFocus, paint } from '../style.js';
import { border, color } from '../token.js';

export type FieldKind = 'text' | 'url' | 'password' | 'number' | 'textarea';

function paintControl(node: HTMLElement): void {
  paint(node, {
    border: border.ink,
    background: color.paper,
    color: 'inherit',
    font: 'inherit',
    letterSpacing: 'inherit',
    padding: '0.2em 0.45em',
  });
  bindFocus(node);
}

/** A labeled text control, area, or select. The control keeps `name` for the form. */
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
  paint(label, { display: 'grid', gap: '4px', margin: '0 0 12px' });
  return label;
}
