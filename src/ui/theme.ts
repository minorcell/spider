import { themes, variableName, type ThemeName, type ThemePalette } from './token.js';

const STYLE_ID = 'ui-theme';
const TRANSITION_MS = 1100;

/**
 * Custom properties are registered so a theme switch can animate the computed
 * colors instead of snapping. Browsers without `@property` simply switch.
 */
function themeStyle(): string {
  const entries = Object.entries(themes.day);
  const declarations = entries
    .map(([key, value]) => {
      const name = variableName(key as keyof ThemePalette);
      return `@property ${name}{syntax:'<color>';inherits:true;initial-value:${value}}`;
    })
    .join('');
  const transitions = entries
    .map(([key]) => `${variableName(key as keyof ThemePalette)} ${TRANSITION_MS}ms ease`)
    .join(',');
  return `${declarations}:root{transition:${transitions}}@media (prefers-reduced-motion: reduce){:root{transition:none}}`;
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = themeStyle();
  doc.head.append(style);
}

/** Install one palette on the root element. Every `var(--ui-*)` follows it. */
export function installTheme(doc: Document, theme: ThemeName): void {
  ensureStyle(doc);
  const root = doc.documentElement;
  for (const [key, value] of Object.entries(themes[theme])) {
    root.style.setProperty(variableName(key as keyof ThemePalette), value);
  }
  root.dataset.theme = theme;
  root.style.setProperty('color-scheme', theme === 'night' ? 'dark' : 'light');
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = themes[theme].paper;
}
