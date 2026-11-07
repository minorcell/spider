import { worldClock, type LightPeriod } from '../shared/ecology.js';
import { installTheme } from '../ui/theme.js';
import type { ThemeName } from '../ui/token.js';

export const LIGHT_BOUNDARY_HOURS = [5, 7, 17, 19] as const;

const CHECK_MS = 60_000;

const SETTLE_MS = 1_000;

export function themeForPeriod(period: LightPeriod): ThemeName {
  return period === 'night' || period === 'dusk' ? 'night' : 'day';
}

export function themeAt(at: Date): ThemeName {
  return themeForPeriod(worldClock(at).period);
}

export function nextLightBoundary(at: Date): number {
  const now = at.getTime();
  for (const hour of LIGHT_BOUNDARY_HOURS) {
    const candidate = new Date(at);
    candidate.setHours(hour, 0, 0, 0);
    if (candidate.getTime() > now) return candidate.getTime();
  }
  const tomorrow = new Date(at);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(LIGHT_BOUNDARY_HOURS[0], 0, 0, 0);
  return tomorrow.getTime();
}

export function startThemeClock(
  doc: Document,
  win: Window = window,
  now: () => Date = () => new Date(),
): () => void {
  let timer = 0;
  let current: ThemeName | null = null;

  const sync = (): void => {
    const at = now();
    const next = themeAt(at);
    if (next !== current) {
      current = next;
      installTheme(doc, next);
    }
    win.clearTimeout(timer);
    const wait = nextLightBoundary(at) - at.getTime() + SETTLE_MS;
    timer = win.setTimeout(sync, Math.min(wait, CHECK_MS));
  };

  const onVisibility = (): void => {
    if (!doc.hidden) sync();
  };

  sync();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pageshow', sync);

  return () => {
    win.clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pageshow', sync);
  };
}
