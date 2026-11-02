/** Ink on paper. Every color, typeface, and rule in the interface comes from here. */

export const color = {
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
} as const;

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
