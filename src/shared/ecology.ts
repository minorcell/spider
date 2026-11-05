/** Local wall-clock information used by client-side world ecology. */

export const LOCAL_DAY_SECONDS = 24 * 60 * 60;

export type LightPeriod = 'night' | 'dawn' | 'day' | 'dusk';

/** Fraction of the normal visual range available under the local light. */
export function visualRangeMultiplier(period: LightPeriod): number {
  return period === 'night' ? 0.55 : period === 'day' ? 1 : 0.8;
}

export interface WorldClock {
  /** Seconds since local midnight, including the current millisecond. */
  localSeconds: number;
  /** Local time as a fraction of a 24-hour day. */
  dayFraction: number;
  /** Sun light in the range [0, 1]. It is zero at night. */
  daylight: number;
  period: LightPeriod;
}

/**
 * Read the browser's local clock. This is deliberately independent from the
 * simulation clock: pausing or restoring a world must not stop the sun.
 */
export function worldClock(at = new Date()): WorldClock {
  const localSeconds =
    at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds() + at.getMilliseconds() / 1000;
  const dayFraction = localSeconds / LOCAL_DAY_SECONDS;
  // Sunrise is 06:00 and sunset is 18:00. The sine gives smooth transitions
  // at both horizons while keeping the value deterministic and allocation-free.
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
