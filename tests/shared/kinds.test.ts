// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { kindOf, KINDS, propertiesOf, slicesOf } from '../../src/shared/kinds.js';

describe('kinds', () => {
  it('finds every known kind', () => {
    for (const name of Object.keys(KINDS)) expect(kindOf(name)).toBe(KINDS[name]);
  });

  it('returns null for something unknown', () => {
    expect(kindOf('rock')).toBeNull();
  });

  it('reuses immutable property lists', () => {
    const properties = propertiesOf('apple');
    expect(properties).toEqual(['edible', 'carryable']);
    expect(propertiesOf('apple')).toBe(properties);
  });

  it('reports no properties for something unknown', () => {
    expect(propertiesOf('rock')).toEqual([]);
  });

  it('counts slices including the removal step', () => {
    expect(slicesOf(KINDS.apple)).toBe(3);
    expect(slicesOf(KINDS.grass)).toBe(0);
    expect(
      slicesOf({
        properties: ['edible'],
        rest: 0,
        eat: { duration: 1, stages: 4, removes: false },
      }),
    ).toBe(4);
  });
});
