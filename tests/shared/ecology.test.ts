// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { visualRange, worldClock } from '../../src/shared/ecology.js';

describe('worldClock', () => {
  it('uses local time and reports smooth daylight', () => {
    const dawn = worldClock(new Date(2026, 0, 1, 6, 0, 0, 0));
    const noon = worldClock(new Date(2026, 0, 1, 12, 0, 0, 0));
    const dusk = worldClock(new Date(2026, 0, 1, 18, 0, 0, 0));
    const night = worldClock(new Date(2026, 0, 1, 23, 59, 59, 999));

    expect(dawn).toMatchObject({ period: 'dawn', daylight: 0 });
    expect(noon).toMatchObject({ period: 'day', daylight: 1 });
    expect(dusk).toMatchObject({ period: 'dusk', daylight: 0 });
    expect(night).toMatchObject({ period: 'night', daylight: 0 });
    expect(noon.localSeconds).toBe(12 * 3600);
    expect(noon.dayFraction).toBe(0.5);
  });

  it('keeps dawn, day, dusk, and night boundaries explicit', () => {
    expect(worldClock(new Date(2026, 0, 1, 4, 59, 59)).period).toBe('night');
    expect(worldClock(new Date(2026, 0, 1, 5, 0)).period).toBe('dawn');
    expect(worldClock(new Date(2026, 0, 1, 7, 0)).period).toBe('day');
    expect(worldClock(new Date(2026, 0, 1, 17, 0)).period).toBe('dusk');
    expect(worldClock(new Date(2026, 0, 1, 19, 0)).period).toBe('night');
  });

  it('opens the view with the clock and only partly with the lamp', () => {
    const at = (hour: number) => worldClock(new Date(2026, 0, 1, hour));
    expect(visualRange(at(12))).toBeCloseTo(1, 2);
    expect(visualRange(at(18))).toBeGreaterThan(0.75);
    expect(visualRange(at(18))).toBeLessThan(0.9);
    expect(visualRange(at(19))).toBeGreaterThan(0.7);
    expect(visualRange(at(19))).toBeLessThan(0.85);
    expect(visualRange(at(6))).toBeCloseTo(visualRange(at(18)), 5);
    expect(visualRange(at(0))).toBeCloseTo(0.1, 2);
    const midnight = visualRange(at(0));
    const lit = visualRange(at(0), true);
    expect(lit).toBeGreaterThan(midnight + 0.4);
    expect(lit).toBeLessThan(0.8);
    expect(visualRange(at(12), true)).toBeCloseTo(1, 2);
  });
});
