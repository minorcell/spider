import { describe, expect, it } from 'vitest';
import { Box3, Group, LineSegments, Mesh, Vector3 } from 'three';
import { buildProp, drapeGrass } from '../../src/client/props.js';
import { nestSurface } from '../../src/shared/nestShape.js';

describe('buildProp', () => {
  it('batches a tree into four draws while retaining crown and trunk detail', () => {
    const tree = buildProp('tree', 0, { kind: 'circle', r: 0.5 }, 'tree-1')!;
    expect(tree.children).toHaveLength(4);
    expect(tree.getObjectByName('trunk')).toBeInstanceOf(Mesh);
    expect(tree.getObjectByName('crown')).toBeInstanceOf(Mesh);
    expect(tree.getObjectByName('outline')).toBeInstanceOf(Mesh);
    expect((tree.getObjectByName('crown') as Mesh).geometry.index!.count).toBeGreaterThan(1000);
  });

  it.each(['tree', 'stone', 'bog-stone'])(
    'builds reproducible %s variants at the saved size',
    (kind) => {
      const small = buildProp(kind, 0, { kind: 'circle', r: 0.5 }, `${kind}-1`)!;
      const again = buildProp(kind, 0, { kind: 'circle', r: 0.5 }, `${kind}-1`)!;
      const large = buildProp(kind, 0, { kind: 'circle', r: 1 }, `${kind}-1`)!;
      const bounds = (group: Group) => new Box3().setFromObject(group).getSize(new Vector3());
      expect(bounds(again).toArray()).toEqual(bounds(small).toArray());
      expect(bounds(large).y).toBeGreaterThan(bounds(small).y);
      expect(small.userData.height).toBeGreaterThan(0);
      expect(bounds(buildProp(kind, 0)!).y).toBeGreaterThan(0);
      expect(bounds(buildProp(kind, 0, { kind: 'box', hx: 1, hz: 1 })!).y).toBeGreaterThan(0);
      for (let seed = 1; seed <= 12; seed++) {
        const variant = buildProp(kind, 0, undefined, `${kind}-${seed}`)!;
        variant.traverse((node) => {
          if (!(node instanceof Mesh || node instanceof LineSegments)) return;
          expect(
            Array.from(node.geometry.getAttribute('position').array).every(Number.isFinite),
          ).toBe(true);
        });
      }
    },
  );

  it('builds an apple at each bite stage', () => {
    for (const stage of [0, 1, 2, 3]) {
      const apple = buildProp('apple', stage);
      expect(apple).toBeInstanceOf(Group);
      expect(apple!.children.length).toBeGreaterThan(1);
    }
  });

  it('gives the apple a curved stem and the nest a shelled pebble', () => {
    const apple = buildProp('apple', 0)!;
    const stem = apple.getObjectByName('stem') as Mesh;
    expect(stem).toBeInstanceOf(Mesh);
    expect(stem.geometry.getAttribute('position').count).toBeGreaterThan(16);
    const shell = stem.children.find((child) => child instanceof Mesh) as Mesh;
    const tube = stem.geometry.getAttribute('position');
    const grown = shell.geometry.getAttribute('position');
    let tubeSpan = 0;
    let shellSpan = 0;
    for (let i = 0; i < tube.count; i++) tubeSpan = Math.max(tubeSpan, Math.abs(tube.getX(i)));
    for (let i = 0; i < grown.count; i++) shellSpan = Math.max(shellSpan, Math.abs(grown.getX(i)));
    expect(shellSpan).toBeGreaterThan(tubeSpan);

    const nest = buildProp('nest', 0)!;
    const pebble = nest.getObjectByName('pebble') as Mesh;
    expect(pebble.children.some((child) => child instanceof Mesh)).toBe(true);
  });

  it('builds the nest as paper meshes and ink line sets', () => {
    const nest = buildProp('nest', 0)!;
    expect(nest).toBeInstanceOf(Group);
    const meshes = nest.children.filter((child) => child instanceof Mesh);
    const lines = nest.children.filter((child) => child instanceof LineSegments);
    expect(meshes.length).toBeGreaterThan(0);
    expect(lines).toHaveLength(1);
    expect(meshes[0].geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(lines[0].geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('builds the nest mound from the same height the legs stand on', () => {
    const nest = buildProp('nest', 0)!;
    nest.position.set(0, 0.02, 0);
    nest.updateMatrixWorld(true);
    const soil = nest.children.find((child) => child instanceof Mesh) as Mesh;
    const position = soil.geometry.getAttribute('position');
    const point = new Vector3();
    const origin = { x: 0, y: 0.02, z: 0 };
    for (let i = 0; i < position.count; i += 80) {
      point.set(position.getX(i), position.getY(i), position.getZ(i));
      point.applyMatrix4(soil.matrixWorld);
      expect(point.y).toBeCloseTo(nestSurface(origin, point.x, point.z), 4);
    }
  });

  it('builds grass as one paper mesh and one ink line set', () => {
    const patch = buildProp('grass', 0, { kind: 'circle', r: 2.5 })!;
    expect(patch).toBeInstanceOf(Group);
    expect(patch.children).toHaveLength(2);
    const paper = patch.children[0];
    const ink = patch.children[1];
    expect(paper).toBeInstanceOf(Mesh);
    expect(ink).toBeInstanceOf(LineSegments);
    expect(paper.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(ink.geometry.getAttribute('position').count).toBeGreaterThan(0);
    // 草成堆而不是一根根散着：每片草的叶片数压在一个小数目里。
    const blades = patch.userData.blades as unknown[];
    expect(blades.length).toBeGreaterThan(10);
    expect(blades.length).toBeLessThan(140);
    const fallback = buildProp('grass', 0, { kind: 'box', hx: 1, hz: 1 });
    expect(fallback).toBeInstanceOf(Group);
    expect(buildProp('grass', 0)).toBeInstanceOf(Group);
  });

  it('gives each patch one of the three grass styles', () => {
    const ids = ['grass-1', 'grass-2', 'grass-3', 'grass-4'];
    const counts = ids.map(
      (id) => (buildProp('grass', 0, undefined, id)!.userData.blades as unknown[]).length,
    );
    expect(counts.every((count) => count > 0)).toBe(true);
    expect(new Set(counts).size).toBeGreaterThan(1);
    expect(buildProp('grass', 0, undefined, 'grass-x')).toBeInstanceOf(Group);
  });

  it('returns null for an unknown kind', () => {
    expect(buildProp('rock', 0)).toBeNull();
  });
});

describe('drapeGrass', () => {
  it('lifts the merged blades onto the ground under the patch', () => {
    const patch = buildProp('grass', 0)!;
    patch.add(new Group());
    const height = (x: number, z: number): number => 0.5 + x * 0.01 + z * 0.02;
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
