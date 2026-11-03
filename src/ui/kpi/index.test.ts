import { afterEach, describe, expect, it, vi } from 'vitest';
import { kpi, kpiGrid } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function media(matches: boolean): void {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener() {
      return undefined;
    },
  }));
}

describe('kpi', () => {
  it('shows a plain value and a value made of nodes', () => {
    const plain = kpi(document, { label: '请求', value: '12', foot: '较上周 +2' });
    expect(plain.className).toBe('kpi');
    expect(plain.querySelector('.kpi-label')?.textContent).toBe('请求');
    expect(plain.querySelector('.kpi-value')?.textContent).toBe('12');
    expect(plain.querySelector('.kpi-foot')?.textContent).toBe('较上周 +2');

    const unit = document.createElement('span');
    unit.className = 'kpi-unit';
    unit.textContent = '%';
    const mixed = kpi(document, {
      label: '缓存',
      value: [document.createTextNode('97'), unit],
      foot: '读 1 · 写 2',
    });
    expect(mixed.querySelector('.kpi-value')?.textContent).toBe('97%');
    expect(unit.style.fontSize).toBe('16px');
  });

  it('lays cards in four columns wide and two on a narrow sheet', () => {
    const card = kpi(document, { label: '请求', value: '1', foot: '脚' });
    const wide = kpiGrid(document, { label: '用量概览' }, card);
    expect(wide.className).toBe('kpis');
    expect(wide.getAttribute('aria-label')).toBe('用量概览');
    expect(wide.style.gridTemplateColumns).toContain('repeat(4');

    media(true);
    const narrow = kpiGrid(document, { label: '用量概览' }, card);
    expect(narrow.style.gridTemplateColumns).toContain('repeat(2');
  });
});
