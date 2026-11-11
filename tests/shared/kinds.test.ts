import { describe, expect, it } from 'vitest';
import { kindOf, KINDS, propertiesOf } from '@/src/shared/kinds';

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
});

it('validates authored grass using its default placement footprint', () => {
  expect(
    KINDS.grass.placement!.fits(
      { height: () => 1 },
      { id: 'grass-test', kind: 'grass', x: 0, y: 1, z: 0, stage: 0 },
    ),
  ).toBe(true);
});
