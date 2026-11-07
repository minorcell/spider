import { describe, expect, it } from 'vitest';
import { SPIDER_BODY } from '../../src/shared/config.js';
import { TERRAIN } from '../../src/shared/terrain.js';
import {
  capHeight,
  floatHeight,
  floatsAt,
  nearestShore,
  readWater,
  sphereVolume,
  submergedFraction,
  surveyWater,
  WATER,
  waterAt,
  waterPace,
} from '../../src/shared/water.js';

describe('waterAt', () => {
  it('reports the column over a hollow and nothing on dry ground', () => {
    const ground = { height: (x: number): number => (x > 0 ? TERRAIN.water - 1.5 : 0) };
    const wet = waterAt(ground, 1, 0);
    expect(wet.surface).toBe(TERRAIN.water);
    expect(wet.depth).toBeCloseTo(1.5);
    expect(waterAt(ground, -1, 0)).toEqual({ surface: Number.NEGATIVE_INFINITY, depth: 0 });
  });

  it('uses a terrain-provided water surface when one is available', () => {
    const ground = {
      height: () => -2,
      surface: () => -0.25,
    };
    expect(waterAt(ground, 0, 0)).toEqual({ surface: -0.25, depth: 1.75 });
  });
});

describe('water pace', () => {
  it('keeps full pace on land and loses speed as it gets deeper', () => {
    expect(waterPace(0)).toBe(1);
    expect(waterPace(WATER.wadeDepth / 2)).toBeCloseTo((1 + WATER.wadePace) / 2);
    expect(waterPace(WATER.wadeDepth)).toBeCloseTo(WATER.wadePace);
    expect(waterPace(WATER.wadeDepth * 2)).toBeCloseTo(WATER.swimPace);
    expect(waterPace(99)).toBeCloseTo(WATER.swimPace);
  });

  it('floats only when the column is deep enough for the body draft', () => {
    expect(floatsAt({ height: () => TERRAIN.water - 0.2 }, 0, 0)).toBe(false);
    expect(floatsAt({ height: () => TERRAIN.water - 2 }, 0, 0)).toBe(true);
  });
});

describe('buoyancy', () => {
  it('floats the spider where displacement balances its weight', () => {
    const water = { surface: -0.8, depth: 1.2 };
    const root = floatHeight(water);
    const bottom = root + SPIDER_BODY.center - SPIDER_BODY.radius;
    const fraction = submergedFraction(bottom, water.surface, SPIDER_BODY.radius);
    expect(fraction).toBeCloseTo(SPIDER_BODY.mass / (SPIDER_BODY.volume * WATER.density), 3);
  });

  it('derives a prop draft from density instead of a per-kind number', () => {
    const radius = 0.36;
    const density = 0.8;
    const draft = capHeight(density, radius);
    expect(submergedFraction(-draft, 0, radius)).toBeCloseTo(density, 3);
    expect(draft).toBeLessThan(2 * radius);
    expect(sphereVolume(radius)).toBeGreaterThan(0);
  });
});

describe('water survey', () => {
  const pond = (x: number, z: number): number => (Math.hypot(x, z) < 2 ? -2 : 0);

  it('reads the nearest water with depth and span', () => {
    const reading = readWater({ height: pond }, 3, 0, 6)!;
    expect(reading.distance).toBeCloseTo(1.25);
    expect(reading.depth).toBeCloseTo(1.2);
    expect(reading.span).toBeGreaterThan(3);
    expect(readWater({ height: () => 0 }, 0, 0, 6)).toBeNull();
  });

  it('measures span and depth only from water, capped at the sense reach', () => {
    expect(surveyWater({ height: pond }, 0, 0, 6)).toMatchObject({ deepest: 1.2 });
    expect(surveyWater({ height: pond }, 0, 0, 6).span).toBeGreaterThan(1.5);
    expect(surveyWater({ height: pond }, 3, 0, 6)).toEqual({ span: 0, deepest: 0 });
    expect(surveyWater({ height: () => -2 }, 0, 0, 6)).toEqual({ span: 6, deepest: 1.2 });
  });

  it('finds the nearest dry shore from water', () => {
    expect(nearestShore({ height: pond }, 0, 0, 6)).toMatchObject({ distance: 2 });
    expect(nearestShore({ height: pond }, 3, 0, 6)).toBeNull();
  });
});
