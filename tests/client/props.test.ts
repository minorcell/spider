import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
import { buildProp, drapeGrass } from '../../src/client/props.js';

describe('buildProp', () => {
  it('builds an apple at each bite stage', () => {
    for (const stage of [0, 1, 2, 3]) {
      const apple = buildProp('apple', stage);
      expect(apple).toBeInstanceOf(Group);
      expect(apple!.children.length).toBeGreaterThan(1);
    }
  });

  it('builds the nest shell', () => {
    expect(buildProp('nest', 0)).toBeInstanceOf(Group);
  });

  it('builds grass from the footprint radius, or a default', () => {
    const patch = buildProp('grass', 0, { kind: 'circle', r: 2.5 });
    expect(patch).toBeInstanceOf(Group);
    expect(patch!.children.length).toBe(64);
    const fallback = buildProp('grass', 0, { kind: 'box', hx: 1, hz: 1 });
    expect(fallback).toBeInstanceOf(Group);
    expect(buildProp('grass', 0)).toBeInstanceOf(Group);
  });

  it('returns null for an unknown kind', () => {
    expect(buildProp('rock', 0)).toBeNull();
  });
});

describe('drapeGrass', () => {
  it('sets each blade on the ground under it and skips non-blades', () => {
    const patch = buildProp('grass', 0)!;
    patch.add(new Group());
    const height = (x: number, z: number): number => x * 0.1 + z * 0.2;
    drapeGrass(patch, 3, -1, height);
    expect(patch.position.toArray()).toEqual([3, 0, -1]);
    const blade = patch.children[0] as Mesh;
    expect(Number.isFinite(blade.position.y)).toBe(true);
    expect(patch.children.at(-1)!.position.y).toBe(0);
  });
});
