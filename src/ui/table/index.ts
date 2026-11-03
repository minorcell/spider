import { h } from '../dom/index.js';
import { paint } from '../style.js';
import { border, color, typeface } from '../token.js';

export type TableCell = Node | string;

export interface TableColumn {
  label: string;
  /** Right-align the column and set it in the mono face. */
  numeric?: boolean;
}

/** A ruled table. A column marked numeric takes `.num` on its head and cells. */
export function table(
  doc: Document,
  options: {
    columns: TableColumn[];
    rows: TableCell[][];
    /** One full-width row when `rows` is empty. */
    empty?: string;
  },
): HTMLTableElement {
  const node = h(doc, 'table', { class: 'table' });
  const head = h(doc, 'thead');
  const headRow = h(doc, 'tr');
  for (const column of options.columns) {
    headRow.append(h(doc, 'th', { class: column.numeric ? 'num' : '' }, column.label));
  }
  head.append(headRow);

  const body = h(doc, 'tbody');
  if (options.rows.length === 0) {
    const cell = h(doc, 'td', { colspan: String(options.columns.length) }, options.empty ?? '');
    body.append(h(doc, 'tr', {}, cell));
  } else {
    for (const cells of options.rows) {
      const row = h(doc, 'tr');
      cells.forEach((cell, index) => {
        const column = options.columns[index]!;
        row.append(h(doc, 'td', { class: column.numeric ? 'num' : '' }, cell));
      });
      body.append(row);
    }
  }
  node.append(head, body);

  paint(node, { width: '100%', borderCollapse: 'collapse', fontSize: '12px' });
  for (const cell of node.querySelectorAll<HTMLElement>('th')) {
    paint(cell, {
      padding: '11px 14px',
      borderBottom: border.ink,
      color: color.muted,
      fontWeight: '400',
      textAlign: 'left',
    });
  }
  const rows = [...body.querySelectorAll<HTMLElement>('tr')];
  rows.forEach((row, index) => {
    for (const cell of row.querySelectorAll<HTMLElement>('td')) {
      paint(cell, {
        padding: '12px 14px',
        borderBottom: index === rows.length - 1 ? '0' : border.hairline,
        verticalAlign: 'middle',
      });
    }
  });
  for (const cell of node.querySelectorAll<HTMLElement>('.num')) {
    paint(cell, { textAlign: 'right', fontFamily: typeface.mono, fontSize: '11px' });
  }
  return node;
}
