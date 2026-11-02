import { describe, expect, it } from 'vitest';
import { icon, iconButton } from './index.js';

describe('icon', () => {
  it('draws a gear', () => {
    const svg = icon(document, 'gear');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path')?.getAttribute('d')).toContain('M6.9');
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
