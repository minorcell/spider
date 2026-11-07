export const LOCAL_DAY_SECONDS = 24 * 60 * 60;

export type LightPeriod = 'night' | 'dawn' | 'day' | 'dusk';

export function visualRange(clock: WorldClock, lamp = false): number {
  const fromNoon = Math.cos((clock.dayFraction - 0.5) * Math.PI * 2);
  const sun = 0.5 + 0.5 * fromNoon;
  const open = 0.1 + 0.9 * sun ** 0.3;
  return lamp ? open + (1 - open) * 0.6 : open;
}

export interface WorldClock {
  localSeconds: number;
  dayFraction: number;
  daylight: number;
  period: LightPeriod;
}

export function worldClock(at = new Date()): WorldClock {
  const localSeconds =
    at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds() + at.getMilliseconds() / 1000;
  const dayFraction = localSeconds / LOCAL_DAY_SECONDS;
  const elevation = Math.sin(dayFraction * Math.PI * 2 - Math.PI / 2);
  const daylight = elevation > 1e-6 ? elevation : 0;
  const period =
    localSeconds < 5 * 3600
      ? 'night'
      : localSeconds < 7 * 3600
        ? 'dawn'
        : localSeconds < 17 * 3600
          ? 'day'
          : localSeconds < 19 * 3600
            ? 'dusk'
            : 'night';
  return { localSeconds, dayFraction, daylight, period };
}
