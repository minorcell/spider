import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIGHT_BOUNDARY_HOURS,
  nextLightBoundary,
  startThemeClock,
  themeAt,
  themeForPeriod,
} from '../../src/client/themeClock.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('themeForPeriod', () => {
  it('uses the dark palette from dusk through the night', () => {
    expect(themeForPeriod('night')).toBe('night');
    expect(themeForPeriod('dusk')).toBe('night');
    expect(themeForPeriod('day')).toBe('day');
    expect(themeForPeriod('dawn')).toBe('day');
  });

  it('reads the local wall clock', () => {
    expect(themeAt(new Date(2026, 0, 1, 12))).toBe('day');
    expect(themeAt(new Date(2026, 0, 1, 18))).toBe('night');
    expect(themeAt(new Date(2026, 0, 1, 23))).toBe('night');
  });
});

describe('nextLightBoundary', () => {
  it('finds the next boundary in the same day', () => {
    expect(nextLightBoundary(new Date(2026, 0, 1, 4, 30))).toBe(
      new Date(2026, 0, 1, LIGHT_BOUNDARY_HOURS[0]).getTime(),
    );
    expect(nextLightBoundary(new Date(2026, 0, 1, 6, 30))).toBe(
      new Date(2026, 0, 1, LIGHT_BOUNDARY_HOURS[1]).getTime(),
    );
    expect(nextLightBoundary(new Date(2026, 0, 1, 18, 30))).toBe(
      new Date(2026, 0, 1, LIGHT_BOUNDARY_HOURS[3]).getTime(),
    );
  });

  it('rolls to the following morning after the last boundary', () => {
    expect(nextLightBoundary(new Date(2026, 0, 1, 20))).toBe(
      new Date(2026, 0, 2, LIGHT_BOUNDARY_HOURS[0]).getTime(),
    );
  });

  it('does not return the boundary it is already standing on', () => {
    expect(nextLightBoundary(new Date(2026, 0, 1, 5))).toBe(
      new Date(2026, 0, 1, LIGHT_BOUNDARY_HOURS[1]).getTime(),
    );
  });
});

describe('startThemeClock', () => {
  it('installs the current theme, rechecks, and stops cleanly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12));

    const doc = document.implementation.createHTMLDocument('clock');
    const meta = doc.createElement('meta');
    meta.name = 'theme-color';
    doc.head.append(meta);

    const stop = startThemeClock(doc);
    expect(doc.documentElement.dataset.theme).toBe('day');
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(60_000);
    expect(doc.documentElement.dataset.theme).toBe('day');
    expect(vi.getTimerCount()).toBe(1);

    Object.defineProperty(doc, 'hidden', { configurable: true, value: true });
    doc.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(doc, 'hidden', { configurable: true, value: false });
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(doc.documentElement.dataset.theme).toBe('day');

    vi.setSystemTime(new Date(2026, 0, 1, 18));
    window.dispatchEvent(new Event('pageshow'));
    expect(doc.documentElement.dataset.theme).toBe('night');
    expect(doc.documentElement.style.getPropertyValue('--ui-paper')).toBe('#172235');

    stop();
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event('pageshow'));
    expect(doc.documentElement.dataset.theme).toBe('night');
  });
});
