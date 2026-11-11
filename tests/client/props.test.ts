import { describe, expect, it } from 'vitest';
import { Box3, DataTexture, Group, LineSegments, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { buildProp, drapeGrass, MODELS, propDrape, showFreshness } from '@/src/client/props';
import { KINDS } from '@/src/shared/kinds';
import { nestSurface } from '@/src/shared/nestShape';
import { treeForm } from '@/src/shared/treeForm';

const bounds = (group: Group | Mesh) => new Box3().setFromObject(group).getSize(new Vector3());

const crownSize = (model: Group) =>
  (model.getObjectByName('crown') as Mesh).geometry.getAttribute('position').count;
const trunkAspect = (model: Group) => {
  const size = bounds(model.getObjectByName('trunk') as Mesh);
  return size.y / Math.max(size.x, size.z);
};

describe('buildProp', () => {
  it('batches leafy and bare trees while retaining their different silhouettes', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `tree-${index}`);
    const idOf = (name: string) => ids.find((id) => treeForm(id).name === name)!;
    const footprint = { kind: 'circle', r: 0.5 } as const;
    const spreading = idOf('spreading');
    const tree = buildProp('tree', 0, footprint, spreading)!;
    expect(tree.children).toHaveLength(4);
    expect(tree.getObjectByName('trunk')).toBeInstanceOf(Mesh);
    expect(tree.getObjectByName('crown')).toBeInstanceOf(Mesh);
    expect(tree.getObjectByName('outline')).toBeInstanceOf(Mesh);
    const crown = tree.getObjectByName('crown') as Mesh;
    expect(crown.geometry.index!.count).toBeGreaterThan(1000);
    const color = crown.geometry.getAttribute('color');
    expect(color.count).toBe(crown.geometry.getAttribute('position').count);
    expect(new Set(color.array).size).toBeGreaterThan(100);
    expect((crown.material as MeshLambertMaterial).vertexColors).toBe(true);

    const trunk = tree.getObjectByName('trunk') as Mesh;
    const uv = trunk.geometry.getAttribute('uv');
    expect(uv.count).toBe(trunk.geometry.getAttribute('position').count);
    expect((trunk.material as MeshLambertMaterial).map).toBeInstanceOf(DataTexture);

    const bare = buildProp('tree', 0, footprint, idOf('bare'))!;
    const sparse = buildProp('tree', 0, footprint, idOf('sparse'))!;
    const slender = buildProp('tree', 0, footprint, idOf('slender'))!;
    const old = buildProp('tree', 0, footprint, idOf('old'))!;
    expect(crownSize(bare)).toBe(0);
    expect((bare.getObjectByName('trunk') as Mesh).geometry.index!.count).toBeGreaterThan(0);
    expect(crownSize(sparse)).toBeGreaterThan(0);
    expect(crownSize(sparse)).toBeLessThan(crownSize(tree));
    expect(bounds(slender).y).toBeGreaterThan(bounds(old).y);
    expect(trunkAspect(slender)).toBeGreaterThan(trunkAspect(old));
  });

  it.each(['tree', 'stone', 'bog-stone'])(
    'builds reproducible %s variants at the saved size',
    (kind) => {
      const small = buildProp(kind, 0, { kind: 'circle', r: 0.5 }, `${kind}-1`)!;
      const again = buildProp(kind, 0, { kind: 'circle', r: 0.5 }, `${kind}-1`)!;
      const large = buildProp(kind, 0, { kind: 'circle', r: 1 }, `${kind}-1`)!;
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

  it.each(['stone', 'bog-stone'])('applies mineral tint and grain to each %s cluster', (kind) => {
    const rock = buildProp(kind, 0, { kind: 'circle', r: 1 }, `${kind}-1`)!;
    expect(rock.children.length).toBeGreaterThan(1);
    for (const boulder of rock.children) {
      const mesh = boulder.children[0] as Mesh;
      const position = mesh.geometry.getAttribute('position');
      const color = mesh.geometry.getAttribute('color');
      const uv = mesh.geometry.getAttribute('uv');
      expect(color.count).toBe(position.count);
      expect(uv.count).toBe(position.count);
      expect(new Set(color.array).size).toBeGreaterThan(20);
      expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(true);
      expect((mesh.material as MeshLambertMaterial).map).toBeInstanceOf(DataTexture);
      expect(boulder.children.some((child) => child instanceof LineSegments)).toBe(true);
    }
  });

  it('builds an apple at each bite stage', () => {
    for (const stage of [0, 1, 2, 3, 4, 5]) {
      const apple = buildProp('apple', stage);
      expect(apple).toBeInstanceOf(Group);
      expect(apple!.children.length).toBeGreaterThan(1);
      expect(apple!.scale.x).toBe(0.54);
    }
  });

  it('shows a paler cut face than the adjacent apple skin', () => {
    const apple = buildProp('apple', 3)!;
    const skin = apple.getObjectByName('fruit-skin') as Mesh;
    const positions = skin.geometry.getAttribute('position');
    const color = skin.geometry.getAttribute('color');
    skin.geometry.computeBoundingBox();
    const cut = skin.geometry.boundingBox!.max.x;
    const flesh: number[] = [];
    const peel: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      if (y < 0.2 || y > 0.5) continue;
      if (Math.abs(x - cut) < 1e-5) flesh.push(color.getY(i));
      else if (x < cut - 0.05) peel.push(color.getY(i));
    }
    expect(flesh.length).toBeGreaterThan(0);
    expect(peel.length).toBeGreaterThan(0);
    expect(Math.max(...flesh)).toBeGreaterThan(Math.max(...peel) + 0.1);
    const leaf = apple.getObjectByName('fruit-leaf') as Mesh;
    expect(leaf).toBeInstanceOf(Mesh);
    leaf.geometry.computeBoundingBox();
    expect(leaf.geometry.boundingBox!.getSize(new Vector3()).z).toBeGreaterThan(0.015);
  });

  it('colors rotten items through shared palette variants without changing fresh neighbours', () => {
    const fresh = buildProp('apple', 0)!;
    const old = buildProp('apple', 0)!;
    const before = (fresh.children[0] as Mesh).material;
    expect((old.children[0] as Mesh).material).toBe(before);
    showFreshness(old, true);
    const rotten = (old.children[0] as Mesh).material;
    expect(rotten).not.toBe(before);
    expect((fresh.children[0] as Mesh).material).toBe(before);
    showFreshness(old, true);
    expect((old.children[0] as Mesh).material).toBe(rotten);
    showFreshness(old, false);
    expect((old.children[0] as Mesh).material).toBe(before);
    KINDS['scaled-round'] = { ...KINDS.berry, modelScale: 0.8 };
    try {
      expect(buildProp('scaled-round', 0)!.scale.x).toBe(0.8);
    } finally {
      delete KINDS['scaled-round'];
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
    const soil = nest.getObjectByName('chamber-floor') as Mesh;
    const position = soil.geometry.getAttribute('position');
    const color = soil.geometry.getAttribute('color');
    expect(color.count).toBe(position.count);
    expect(new Set(color.array).size).toBeGreaterThan(20);
    expect((soil.material as MeshLambertMaterial).map).toBeInstanceOf(DataTexture);
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

  it('uses registered radii for a flattened pebble and shrinks a bitten berry', () => {
    const pebble = buildProp('pebble', 0)!;
    const berry = buildProp('berry', 0)!;
    const bitten = buildProp('berry', 1)!;
    const rockSize = bounds(pebble);
    const diameter = 2 * KINDS.pebble.physics!.radius;
    expect(rockSize.x).toBeGreaterThan(diameter * 0.85);
    expect(rockSize.x).toBeLessThan(diameter * 1.05);
    expect(rockSize.y).toBeLessThan(rockSize.x * 0.85);
    const freshSkin = berry.getObjectByName('berry-skin') as Mesh;
    const bittenSkin = bitten.getObjectByName('berry-skin') as Mesh;
    const color = freshSkin.geometry.getAttribute('color');
    expect(new Set(color.array).size).toBeGreaterThan(20);
    expect(freshSkin.getObjectByName('berry-calyx')).toBeInstanceOf(Mesh);
    expect(bounds(bitten).y).toBeLessThan(bounds(berry).y);
    expect(bittenSkin.material).toBe(freshSkin.material);
    showFreshness(bitten, true);
    expect(bittenSkin.material).not.toBe(freshSkin.material);
  });

  it('uses the default size and shares material for registered round decorations', () => {
    KINDS.decoration = { rest: 0, model: { color: 0x9bc9a8, segments: 8 } };
    try {
      const first = buildProp('decoration', 0)!;
      const second = buildProp('decoration', 0)!;
      expect(bounds(first).y).toBeCloseTo(0.4);
      expect((first.children[0] as Mesh).material).toBe((second.children[0] as Mesh).material);
    } finally {
      delete KINDS.decoration;
    }
  });

  it('resolves new model registrations and rejects missing or inherited model IDs', () => {
    const model = new Group();
    const drape = (): void => {};
    MODELS.banner = { build: () => model, drape };
    KINDS.banner = { rest: 0, model: 'banner' };
    try {
      expect(buildProp('banner', 0)).toBe(model);
      expect(propDrape('banner')).toBe(drape);
      expect(propDrape('grass')).toBe(drapeGrass);
      expect(propDrape('apple')).toBeUndefined();
      expect(propDrape('berry')).toBeUndefined();
      expect(propDrape('missing')).toBeUndefined();
      KINDS.banner.model = 'missing';
      expect(buildProp('banner', 0)).toBeNull();
      expect(propDrape('banner')).toBeUndefined();
      KINDS.banner.model = 'constructor';
      expect(buildProp('banner', 0)).toBeNull();
    } finally {
      delete MODELS.banner;
      delete KINDS.banner;
    }
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
