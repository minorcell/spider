import { describe, expect, it } from 'vitest';
import {
  NEST_DOOR,
  NEST_FLOOR,
  NEST_RI,
  NEST_RO,
  NEST_SCALE_XZ,
  NEST_SCALE_Y,
  nestDoor,
  nestLocalHeight,
  nestRimRadius,
  nestSurface,
} from '@/src/shared/nestShape';

describe('nest shape', () => {
  it('keeps the chamber floor low, the rear bank high, and the door open', () => {
    const floor = nestLocalHeight(0, 0);
    expect(floor).toBeCloseTo(NEST_FLOOR);
    const back = Math.PI / 2;
    const rim = nestLocalHeight(nestRimRadius(back), back);
    expect(rim).toBeGreaterThan(floor + 0.4);
    const door = nestLocalHeight(NEST_RI + 0.4, NEST_DOOR);
    expect(nestDoor(NEST_DOOR)).toBe(1);
    expect(nestDoor(back)).toBe(0);
    expect(door).toBeLessThan(rim);
    expect(nestDoor(NEST_DOOR + 0.5)).toBeGreaterThan(0);
    expect(nestDoor(NEST_DOOR + 0.5)).toBeLessThan(1);
  });

  it('covers the inner floor, the slope, and the outer falloff', () => {
    const angle = 0.2;
    expect(nestLocalHeight(NEST_RI * 0.5, angle)).toBeGreaterThan(NEST_FLOOR);
    const crest = nestLocalHeight(2.2, angle);
    const outside = nestLocalHeight(NEST_RO - 0.05, angle);
    expect(outside).toBeLessThan(crest);
    expect(outside).toBeGreaterThanOrEqual(0);
  });

  it('joins the floor to the inner shoulder continuously', () => {
    for (const angle of [NEST_DOOR, NEST_DOOR + 0.5, 0, Math.PI / 2]) {
      const inside = nestLocalHeight(NEST_RI - 1e-5, angle);
      const outside = nestLocalHeight(NEST_RI + 1e-5, angle);
      expect(outside).toBeCloseTo(inside, 4);
    }
  });

  it('eases into the rear crest and down to the outer edge', () => {
    const angle = Math.PI / 2;
    const crest = nestRimRadius(angle);
    const step = 1e-5;
    const height = nestLocalHeight(crest, angle);
    const edge = nestLocalHeight(NEST_RO, angle);
    expect((height - nestLocalHeight(crest - step, angle)) / step).toBeCloseTo(0, 3);
    expect((nestLocalHeight(crest + step, angle) - height) / step).toBeCloseTo(0, 3);
    expect((edge - nestLocalHeight(NEST_RO - step, angle)) / step).toBeCloseTo(0, 3);
  });

  it('lifts a world point onto the mound and ignores the island beyond it', () => {
    const origin = { x: 1, y: 0.02, z: -2 };
    const center = nestSurface(origin, origin.x, origin.z);
    expect(center).toBeCloseTo(origin.y + NEST_FLOOR * NEST_SCALE_Y);
    expect(nestSurface(origin, origin.x + 20, origin.z)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('keeps the outer rim finite within the mesh rounding tolerance', () => {
    const origin = { x: 1, y: 0.02, z: -2 };
    for (const radius of [NEST_RO, NEST_RO + 0.00005]) {
      const height = nestSurface(origin, origin.x + radius * NEST_SCALE_XZ, origin.z);
      expect(height).toBeCloseTo(origin.y);
    }
  });
});
