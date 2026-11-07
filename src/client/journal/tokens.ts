const TOKEN_SUFFIX = ['', 'k', 'm', 'b'] as const;

export function formatTokens(value: number): string {
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < TOKEN_SUFFIX.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  if (unit === 0) return String(Math.trunc(scaled));
  let shown = Math.round(scaled * 10) / 10;
  if (shown >= 1000 && unit < TOKEN_SUFFIX.length - 1) {
    shown = Math.round((shown / 1000) * 10) / 10;
    unit += 1;
  }
  const text = Number.isInteger(shown) ? String(shown) : shown.toFixed(1);
  return `${text}${TOKEN_SUFFIX[unit]}`;
}
