// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createNoise, fbm, mulberry32 } from '../../src/shared/noise.js';

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 200 }, () => a());
    expect(values).toEqual(Array.from({ length: 200 }, () => b()));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('separates streams by seed', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('createNoise', () => {
  it('rebuilds the same field for a seed', () => {
    const a = createNoise(7);
    const b = createNoise(7);
    for (const [x, y] of [
      [0, 0],
      [1.3, -2.7],
      [-10.5, 8.25],
    ]) {
      expect(a(x, y)).toBe(b(x, y));
    }
  });

  it('differs between seeds', () => {
    const a = createNoise(1);
    const b = createNoise(2);
    expect(a(3.2, -1.4)).not.toBe(b(3.2, -1.4));
  });

  it('exercises every gradient corner', () => {
    const noise = createNoise(1234);
    const signs = new Set<string>();
    for (let x = -12; x < 12; x += 0.31) {
      for (let y = -12; y < 12; y += 0.37) {
        signs.add(`${Math.sign(noise(x, y))}`);
      }
    }
    // The four gradients produce different signs around zero.
    expect(signs.size).toBeGreaterThan(1);
  });
});

describe('fbm', () => {
  it('keeps a constant field constant', () => {
    expect(fbm(() => 0.5, 3, 4)).toBeCloseTo(0.5);
  });

  it('sums five octaves', () => {
    const calls: Array<[number, number]> = [];
    fbm(
      (x, y) => {
        calls.push([x, y]);
        return 1;
      },
      1,
      2,
    );
    expect(calls).toEqual([
      [1, 2],
      [2, 4],
      [4, 8],
      [8, 16],
      [16, 32],
    ]);
  });
});
