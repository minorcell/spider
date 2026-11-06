/** Ink on paper. Every color, typeface, and rule in the interface comes from here. */

export type ThemeName = 'day' | 'night';

export interface ThemePalette {
  ink: string;
  paper: string;
  paperDeep: string;
  veil: string;
  muted: string;
  hairline: string;
  hatch: string;
  hatchStrong: string;
  grid: string;
  output: string;
  cache: string;
  cacheWrite: string;
  prose: string;
  reason: string;
}

export const themes: Record<ThemeName, ThemePalette> = {
  day: {
    ink: '#1b1714',
    paper: '#f3efe6',
    paperDeep: '#e9e4da',
    veil: 'rgba(243, 239, 230, 0.78)',
    muted: 'rgba(27, 23, 20, 0.62)',
    hairline: 'rgba(27, 23, 20, 0.18)',
    hatch: 'rgba(27, 23, 20, 0.25)',
    hatchStrong: 'rgba(27, 23, 20, 0.35)',
    grid: 'rgba(27, 23, 20, 0.08)',
    output: 'rgba(27, 23, 20, 0.68)',
    cache: '#8e877e',
    cacheWrite: '#c8c1b7',
    prose: '#5e5750',
    reason: '#aaa298',
  },
  night: {
    ink: '#e8e3d8',
    paper: '#172235',
    paperDeep: '#1e2b3d',
    veil: 'rgba(8, 13, 22, 0.82)',
    muted: 'rgba(232, 227, 216, 0.64)',
    hairline: 'rgba(232, 227, 216, 0.2)',
    hatch: 'rgba(232, 227, 216, 0.26)',
    hatchStrong: 'rgba(232, 227, 216, 0.38)',
    grid: 'rgba(232, 227, 216, 0.1)',
    output: 'rgba(232, 227, 216, 0.72)',
    cache: '#9aa7b8',
    cacheWrite: '#6c7a8c',
    prose: '#b5ac9e',
    reason: '#8b94a2',
  },
};

/** Semantic names never change; only the variables installed on the root do. */
export const color: Record<keyof ThemePalette, string> = {
  ink: 'var(--ui-ink)',
  paper: 'var(--ui-paper)',
  paperDeep: 'var(--ui-paper-deep)',
  veil: 'var(--ui-veil)',
  muted: 'var(--ui-muted)',
  hairline: 'var(--ui-hairline)',
  hatch: 'var(--ui-hatch)',
  hatchStrong: 'var(--ui-hatch-strong)',
  grid: 'var(--ui-grid)',
  output: 'var(--ui-output)',
  cache: 'var(--ui-cache)',
  cacheWrite: 'var(--ui-cache-write)',
  prose: 'var(--ui-prose)',
  reason: 'var(--ui-reason)',
};

/** `paperDeep` keeps its camel case in TypeScript but loses it in the custom property. */
export function variableName(key: keyof ThemePalette): string {
  return `--ui-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export const typeface = {
  serif: "'Iowan Old Style', 'Palatino Linotype', 'Songti SC', serif",
  mono: "'SFMono-Regular', Consolas, monospace",
} as const;

export const font = {
  body: `14px/1.65 ${typeface.serif}`,
  read: `13px/1.55 ${typeface.serif}`,
  pin: `12px/1.3 ${typeface.serif}`,
  axis: `10px/1 ${typeface.mono}`,
  mono: `11px ${typeface.mono}`,
  step: `10px ${typeface.mono}`,
} as const;

export const border = {
  ink: `1px solid ${color.ink}`,
  hairline: `1px solid ${color.hairline}`,
} as const;

/** Viewport queries the layout listens for. */
export const media = {
  pilot: '(max-width: 800px)',
  sheet: '(max-width: 820px)',
  phone: '(max-width: 620px)',
} as const;

export const ring = [color.ink, color.cache, color.cacheWrite, color.prose, color.reason] as const;
