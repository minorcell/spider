import { describe, expect, it } from 'vitest';
import { icon, iconButton } from './index.js';

describe('icon', () => {
  it('draws a gear', () => {
    const svg = icon(document, 'gear');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path')?.getAttribute('d')).toContain('M6.9');
    expect(svg.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('draws the GitHub mark and a star', () => {
    const mark = icon(document, 'github');
    expect(mark.querySelector('path')?.getAttribute('d')).toContain('M8 0C3.58');
    expect(mark.querySelector('path')?.getAttribute('fill-rule')).toBe('nonzero');

    const star = icon(document, 'star');
    expect(star.querySelector('path')?.getAttribute('d')).toContain('M8 1.6');
  });

  it('draws a terminal for local providers', () => {
    const svg = icon(document, 'terminal');
    expect(svg.querySelector('path')?.getAttribute('d')).toContain('M1 3h14v10');
    expect(svg.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('draws a cloud for online providers', () => {
    const svg = icon(document, 'cloud');
    expect(svg.querySelector('path')?.getAttribute('d')).toContain('M4.5 12.5');
    expect(svg.querySelector('path')?.getAttribute('fill-rule')).toBe('nonzero');
  });

  it('builds an icon button with or without an id', () => {
    const named = iconButton(document, 'gear', { id: 'settings-open', label: '设置' });
    const plain = iconButton(document, 'gear', { label: '设置' });
    expect(named.id).toBe('settings-open');
    expect(named.getAttribute('aria-label')).toBe('设置');
    expect(named.style.width).toBe('2em');
    expect(named.querySelector('svg')).not.toBeNull();
    expect(plain.hasAttribute('id')).toBe(false);
  });
});
