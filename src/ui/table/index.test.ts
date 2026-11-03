import { describe, expect, it } from 'vitest';
import { table } from './index.js';

describe('table', () => {
  it('builds text and numeric columns and drops the rule under the last row', () => {
    const node = table(document, {
      columns: [{ label: '工具' }, { label: '调用', numeric: true }],
      rows: [
        ['look', '2'],
        [document.createTextNode('walk'), '1'],
      ],
    });

    expect(node.className).toBe('table');
    expect(node.style.borderCollapse).toBe('collapse');
    const heads = [...node.querySelectorAll('th')];
    expect(heads.map((head) => head.textContent)).toEqual(['工具', '调用']);
    expect(heads[0]!.className).toBe('');
    expect(heads[1]!.className).toBe('num');
    expect(heads[1]!.style.textAlign).toBe('right');

    const rows = [...node.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    const first = [...rows[0]!.querySelectorAll('td')];
    expect(first[0]!.className).toBe('');
    expect(first[1]!.className).toBe('num');
    expect(first[1]!.style.fontFamily).toContain('monospace');
    expect(first[1]!.style.borderBottom).not.toBe('0px');
    const last = [...rows[1]!.querySelectorAll('td')];
    expect(last[1]!.style.borderBottom).toBe('0px');
  });

  it('spans a message across an empty table and leaves it blank without one', () => {
    const withMessage = table(document, {
      columns: [{ label: '模型' }, { label: '请求', numeric: true }],
      rows: [],
      empty: '还没有记录。',
    });
    const cell = withMessage.querySelector('tbody td')!;
    expect(cell.colSpan).toBe(2);
    expect(cell.textContent).toBe('还没有记录。');
    expect(cell.style.borderBottom).toBe('0px');

    const bare = table(document, { columns: [{ label: '模型' }], rows: [] });
    expect(bare.querySelector('tbody td')!.textContent).toBe('');
  });
});
