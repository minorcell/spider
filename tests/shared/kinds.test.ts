import { describe, expect, it } from 'vitest';
import { kindOf, KINDS, propertiesOf, slicesOf } from '@/src/shared/kinds';

describe('kinds', () => {
  it('finds every known kind', () => {
    for (const name of Object.keys(KINDS)) expect(kindOf(name)).toBe(KINDS[name]);
  });

  it('returns null for something unknown', () => {
    expect(kindOf('rock')).toBeNull();
  });

  it('reports edible and carryable capabilities', () => {
    const properties = propertiesOf('apple');
    expect(properties).toEqual(['edible', 'carryable']);
  });

  it('reports no properties for something unknown', () => {
    expect(propertiesOf('rock')).toEqual([]);
  });

  it('counts slices including the removal step', () => {
    expect(slicesOf(KINDS.apple)).toBe(3);
    expect(slicesOf(KINDS.grass)).toBe(0);
    expect(
      slicesOf({
        rest: 0,
        eat: { duration: 1, stages: 4, removes: false },
      }),
    ).toBe(4);
  });
});

it('validates authored grass using its default placement footprint', () => {
  expect(
    KINDS.grass.placement!.fits(
      { height: () => 1 },
      { id: 'grass-test', kind: 'grass', x: 0, y: 1, z: 0, stage: 0 },
    ),
  ).toBe(true);
});
