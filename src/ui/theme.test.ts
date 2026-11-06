import { describe, expect, it } from 'vitest';
import { installTheme } from './theme.js';
import { themes } from './token.js';

function docWithMeta(): Document {
  const doc = document.implementation.createHTMLDocument('theme');
  const meta = doc.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#ffffff';
  doc.head.append(meta);
  return doc;
}

describe('installTheme', () => {
  it('installs the day palette, its variables, and the browser chrome color', () => {
    const doc = docWithMeta();
    installTheme(doc, 'day');

    expect(doc.documentElement.dataset.theme).toBe('day');
    expect(doc.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
    expect(doc.documentElement.style.getPropertyValue('--ui-ink')).toBe(themes.day.ink);
    expect(doc.documentElement.style.getPropertyValue('--ui-paper')).toBe(themes.day.paper);
    expect(doc.documentElement.style.getPropertyValue('--ui-paper-deep')).toBe(
      themes.day.paperDeep,
    );
    expect(doc.documentElement.style.getPropertyValue('--ui-cache-write')).toBe(
      themes.day.cacheWrite,
    );
    expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      themes.day.paper,
    );

    const style = doc.getElementById('ui-theme');
    expect(style?.textContent).toContain('@property --ui-paper');
    expect(style?.textContent).toContain('prefers-reduced-motion');
  });

  it('switches to night without adding a second style block', () => {
    const doc = docWithMeta();
    installTheme(doc, 'day');
    installTheme(doc, 'night');

    expect(doc.querySelectorAll('#ui-theme')).toHaveLength(1);
    expect(doc.documentElement.dataset.theme).toBe('night');
    expect(doc.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(doc.documentElement.style.getPropertyValue('--ui-ink')).toBe(themes.night.ink);
    expect(doc.documentElement.style.getPropertyValue('--ui-paper')).toBe(themes.night.paper);
    expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      themes.night.paper,
    );
  });

  it('still works on a document without a theme-color meta', () => {
    const doc = document.implementation.createHTMLDocument('bare');
    installTheme(doc, 'night');
    expect(doc.documentElement.dataset.theme).toBe('night');
    expect(doc.querySelector('meta[name="theme-color"]')).toBeNull();
  });
});
