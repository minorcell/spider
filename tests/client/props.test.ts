import { describe, expect, it } from 'vitest';
import { Group, LineSegments, Mesh } from 'three';
import { buildProp, drapeGrass } from '../../src/client/props.js';

describe('buildProp', () => {
  it('builds an apple at each bite stage', () => {
    for (const stage of [0, 1, 2, 3]) {
      const apple = buildProp('apple', stage);
      expect(apple).toBeInstanceOf(Group);
      expect(apple!.children.length).toBeGreaterThan(1);
    }
  });

  it('builds the nest as one paper mesh and one ink line set', () => {
    const nest = buildProp('nest', 0)!;
    expect(nest).toBeInstanceOf(Group);
    expect(nest.children).toHaveLength(2);
    const paper = nest.children[0];
    const ink = nest.children[1];
    expect(paper).toBeInstanceOf(Mesh);
    expect(ink).toBeInstanceOf(LineSegments);
    expect(paper.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(ink.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('builds grass as one paper mesh and one ink line set', () => {
    const patch = buildProp('grass', 0, { kind: 'circle', r: 2.5 })!;
    expect(patch).toBeInstanceOf(Group);
    expect(patch.children).toHaveLength(2);
    const paper = patch.children[0];
    const ink = patch.children[1];
    expect(paper).toBeInstanceOf(Mesh);
    expect(ink).toBeInstanceOf(LineSegments);
    expect(paper.geometry.getAttribute('position').count).toBeGreaterThan(64 * 3);
    expect(ink.geometry.getAttribute('position').count).toBeGreaterThan(64 * 2);
    const fallback = buildProp('grass', 0, { kind: 'box', hx: 1, hz: 1 });
    expect(fallback).toBeInstanceOf(Group);
    expect(buildProp('grass', 0)).toBeInstanceOf(Group);
  });

  it('returns null for an unknown kind', () => {
    expect(buildProp('rock', 0)).toBeNull();
  });
});

describe('drapeGrass', () => {
  it('lifts the merged blades onto the ground under the patch', () => {
    const patch = buildProp('grass', 0)!;
    patch.add(new Group());
    const height = (x: number, z: number): number => x * 0.1 + z * 0.2;
    drapeGrass(patch, 3, -1, height);
    expect(patch.position.toArray()).toEqual([3, 0, -1]);
    const paper = (patch.children[0] as Mesh).geometry.getAttribute('position');
    const ink = (patch.children[1] as LineSegments).geometry.getAttribute('position');
    expect(Number.isFinite(paper.getY(0))).toBe(true);
    expect(paper.getY(0)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ink.getY(0))).toBe(true);
    expect(patch.children.at(-1)!.position.y).toBe(0);
  });

  it('ignores a group that was not built as grass', () => {
    const group = new Group();
    expect(() => drapeGrass(group, 1, 2, () => 0)).not.toThrow();
    expect(group.position.toArray()).toEqual([1, 0, 2]);
  });
});
