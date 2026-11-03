import { afterEach, describe, expect, it, vi } from 'vitest';
import { facts } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('facts', () => {
  it('lays fields in three columns, indents under a summary, and spans the extra row', () => {
    const body = document.createElement('span');
    body.textContent = 'x';
    const node = facts(
      document,
      { className: 'request-detail', inset: true },
      [
        { label: '输入', value: '12' },
        { label: '输出', value: body },
      ],
      document.createElement('i'),
    );
    expect(node.className).toBe('request-detail');
    expect(node.children).toHaveLength(3);
    expect(node.querySelector('strong')?.textContent).toBe('输入');
    expect(node.textContent).toContain('12');
    expect(node.textContent).toContain('x');
    expect(node.style.gridTemplateColumns).toContain('repeat(3');
    expect(node.style.paddingLeft).toBe('103px');
    const tail = node.querySelector<HTMLElement>('.facts-extra')!;
    expect(tail.style.gridColumn).toBe('1/-1');
  });

  it('uses the default name, no indent, and one column on a phone', () => {
    const plain = facts(document, {}, [{ label: '合计', value: '1' }]);
    expect(plain.className).toBe('facts');
    expect(plain.style.paddingLeft).toBe('15px');
    expect(plain.querySelector('.facts-extra')).toBeNull();

    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {
        return undefined;
      },
    }));
    const phone = facts(document, { inset: true }, [{ label: '合计', value: '1' }]);
    expect(phone.style.gridTemplateColumns).toBe('1fr');
    expect(phone.style.paddingLeft).toBe('15px');
  });
});
