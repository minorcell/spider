import { describe, expect, it } from 'vitest';
import { donutChart, stackedBarChart } from './index.js';

describe('stackedBarChart', () => {
  it('draws one column per day and an empty day as a zero bar', () => {
    const node = stackedBarChart(document, {
      title: '每日消耗',
      hint: 'token · 最近 7 天',
      ariaLabel: '每日输入输出 token 柱状图',
      ticks: ['10', '0'],
      bars: [
        { label: '今天', height: 100, input: 80, output: 20 },
        { label: '11/1', height: 0, input: 0, output: 0 },
      ],
    });
    const groups = node.querySelectorAll('.bar-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelector('.bar-stack')?.getAttribute('style')).toContain('100%');
    expect(groups[1]?.querySelector('.bar.input')?.getAttribute('style')).toContain('0%');
    expect(node.querySelector('.bars')?.getAttribute('aria-label')).toBe(
      '每日输入输出 token 柱状图',
    );
    expect(node.textContent).toContain('输入');
    expect(node.textContent).toContain('输出');
  });
});

describe('donutChart', () => {
  it('splits the ring by amount and leaves a blank ring when every part is zero', () => {
    const filled = donutChart(document, {
      title: 'Token 构成',
      hint: '10 输入 · 2 输出',
      center: '12',
      caption: '总 token',
      parts: [
        { name: '新输入', value: '6', amount: 6, tone: '' },
        { name: '缓存读取', value: '4', amount: 4, tone: 'cache' },
        { name: '缓存写入', value: '0', amount: 0, tone: 'write' },
      ],
    });
    expect(filled.querySelector('.donut')?.style.background).toContain('conic-gradient');
    expect(filled.querySelector('.donut-center strong')?.textContent).toBe('12');
    const rows = [...filled.querySelectorAll('.break-row strong')].map((node) => node.textContent);
    expect(rows).toEqual(['6', '4', '0']);
    expect(filled.querySelector('.fill.cache')?.getAttribute('style')).toContain('40%');

    const empty = donutChart(document, {
      title: 'Token 构成',
      hint: '0 输入 · 0 输出',
      center: '0',
      caption: '总 token',
      parts: [{ name: '新输入', value: '0', amount: 0, tone: '' }],
    });
    expect(empty.querySelector('.donut')?.style.background).toBe('var(--ui-paper-deep)');
    expect(empty.querySelector('.fill')?.getAttribute('style')).toContain('0%');
  });
});
