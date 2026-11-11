export type ThemeName = 'day' | 'night';

export interface ThemePalette {
  ink: string;
  control: string;
  accent: string;
  onAccent: string;
  selected: string;
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
    ink: '#eff3e6',
    control: '#23322a',
    accent: '#dcf889',
    onAccent: '#192417',
    selected: '#33452a',
    paper: '#19241f',
    paperDeep: '#131d19',
    veil: 'rgba(10, 17, 14, 0.68)',
    muted: '#acbdb1',
    hairline: '#42574b',
    hatch: 'rgba(176, 199, 183, 0.25)',
    hatchStrong: 'rgba(176, 199, 183, 0.42)',
    grid: 'rgba(176, 199, 183, 0.12)',
    output: '#79c8bb',
    cache: '#a8cc7b',
    cacheWrite: '#658c6c',
    prose: '#ccd9cd',
    reason: '#b5c59b',
  },
  night: {
    ink: '#ebf0e6',
    control: '#202e28',
    accent: '#cfe981',
    onAccent: '#182218',
    selected: '#2d3e28',
    paper: '#16201d',
    paperDeep: '#101917',
    veil: 'rgba(6, 12, 10, 0.76)',
    muted: '#aabcb4',
    hairline: '#3c5149',
    hatch: 'rgba(158, 185, 173, 0.25)',
    hatchStrong: 'rgba(158, 185, 173, 0.42)',
    grid: 'rgba(158, 185, 173, 0.12)',
    output: '#75b7bc',
    cache: '#a4c779',
    cacheWrite: '#5d8975',
    prose: '#c4d3ca',
    reason: '#aebf9a',
  },
};

export const color: Record<keyof ThemePalette, string> = {
  ink: 'var(--ui-ink)',
  control: 'var(--ui-control)',
  accent: 'var(--ui-accent)',
  onAccent: 'var(--ui-on-accent)',
  selected: 'var(--ui-selected)',
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

export function variableName(key: keyof ThemePalette): string {
  return `--ui-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export const typeface = {
  sans: "Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  mono: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
} as const;

export const font = {
  body: `14px/1.65 ${typeface.sans}`,
  read: `13px/1.55 ${typeface.sans}`,
  pin: `12px/1.3 ${typeface.sans}`,
  axis: `10px/1 ${typeface.mono}`,
  mono: `11px ${typeface.mono}`,
  step: `10px ${typeface.mono}`,
} as const;

export const border = {
  ink: `1px solid ${color.ink}`,
  focus: `1px solid ${color.accent}`,
  hairline: `1px solid ${color.hairline}`,
} as const;

export const controlStyle = {
  boxSizing: 'border-box',
  minHeight: '36px',
  border: border.hairline,
  borderRadius: '5px',
  background: color.control,
  color: color.ink,
} as const;

export const panelStyle = {
  border: border.hairline,
  borderRadius: '9px',
  background: color.paper,
} as const;

export const media = {
  pilot: '(max-width: 800px)',
  sheet: '(max-width: 820px)',
  phone: '(max-width: 620px)',
} as const;

export const ring = [color.ink, color.cache, color.cacheWrite, color.prose, color.reason] as const;
