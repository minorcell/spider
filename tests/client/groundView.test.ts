import { describe, expect, it } from 'vitest';
import { Group, LineSegments, Mesh } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { buildIsland, groundGeometry, tickWater } from '@/src/client/groundView';
import { TERRAIN } from '@/src/shared/terrain';

const shoreSlope = (x: number, z: number): number => TERRAIN.water + x * 0.07 + z * 0.04;

function coverLift(height: number): number {
  const cover = buildIsland(() => height).getObjectByName('ground-cover') as Mesh;
  const position = cover.geometry.getAttribute('position');
  expect(position.count).toBeGreaterThan(0);
  let lift = 0;
  for (let i = 0; i < position.count; i++) lift = Math.max(lift, position.getY(i) - height);
  return lift;
}

describe('groundGeometry', () => {
  it('tints steep surfaces differently from level ground at the same elevation', () => {
    const flat = groundGeometry(() => 0, 4, 2).getAttribute('color');
    const steep = groundGeometry((x) => x * 2, 4, 2).getAttribute('color');
    const middle = 4;
    expect(steep.getX(middle)).not.toBe(flat.getX(middle));
  });

  it('adds reproducible pigment variation across a level meadow', () => {
    const first = groundGeometry(() => 1, 16, 8).getAttribute('color');
    const again = groundGeometry(() => 1, 16, 8).getAttribute('color');
    expect(first.array).toEqual(again.array);
    const patches = new Set(
      Array.from({ length: first.count }, (_, index) =>
        [first.getX(index), first.getY(index), first.getZ(index)]
          .map((channel) => Math.round(channel * 255))
          .join(','),
      ),
    );
    expect(patches.size).toBeGreaterThan(12);
  });

  it('displaces the plane onto the height field', () => {
    const height = (x: number, z: number): number => x * 0.1 + z * 0.2;
    const geo = groundGeometry(height, 4, 2);
    const position = geo.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBeCloseTo(height(position.getX(i), position.getZ(i)));
    }
    expect(geo.getAttribute('normal')).toBeDefined();
  });
});

describe('buildIsland', () => {
  it('builds ground cover and water without grid or contour lines', () => {
    const height = (x: number, z: number): number => x * 0.1 + z * 0.2;
    const island = buildIsland(height);
    expect(island).toBeInstanceOf(Group);
    expect(island.children).toHaveLength(3);
    expect(island.children[0]).toBeInstanceOf(Mesh);
    expect(island.children.some((child) => child instanceof LineSegments)).toBe(false);
    const cover = island.children[1] as Mesh;
    expect(cover.name).toBe('ground-cover');
    const position = cover.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const lift = position.getY(i) - height(x, z);
      expect(lift).toBeGreaterThan(0);
      expect(lift).toBeLessThan(0.16);
    }
    const water = island.children[2] as Mesh;
    expect(water).toBeInstanceOf(Mesh);
    expect(water.name).toBe('water');
    expect(water.position.y).toBeCloseTo(TERRAIN.water + 0.01);
    expect(water.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(water.material).toBeInstanceOf(MeshBasicNodeMaterial);
    const material = water.material as MeshBasicNodeMaterial;
    expect(material.colorNode).toBeTruthy();
    expect(material.opacityNode).toBeTruthy();
    expect(material.positionNode).toBeTruthy();
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(water.geometry.getAttribute('position').count).toBeGreaterThan(1000);
  });

  it('assigns water depth from the baked terrain below each water vertex', () => {
    const water = buildIsland(shoreSlope).getObjectByName('water') as Mesh;
    const position = water.geometry.getAttribute('position');
    const depth = water.geometry.getAttribute('waterDepth');
    expect(depth.count).toBe(position.count);
    let shallow = false;
    let deep = false;
    for (let i = 0; i < position.count; i += 17) {
      const expected = TERRAIN.water - shoreSlope(position.getX(i), -position.getY(i));
      expect(depth.getX(i)).toBeCloseTo(expected, 5);
      if (expected > 0 && expected < 0.1) shallow = true;
      if (expected > 1) deep = true;
    }
    expect(shallow).toBe(true);
    expect(deep).toBe(true);
  });

  it('advances the water highlight clock', () => {
    const water = buildIsland(() => 0).children[2] as Mesh;
    const material = water.material as MeshBasicNodeMaterial;
    tickWater(12.5);
    expect(material.userData.uTime.value).toBe(12.5);
    tickWater(12.55);
    expect(material.userData.uTime.value).toBe(12.55);
    tickWater(1);
    expect(material.userData.uTime.value).toBe(1);
  });

  it('places low cover on flat ground', () => {
    const island = buildIsland(() => 1);
    const position = (island.children[1] as Mesh).geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    expect(position.getY(0)).toBeCloseTo(1.012);
  });

  it('keeps shore cover low while meadow blades rise above it', () => {
    const shore = coverLift(TERRAIN.water + 0.1);
    expect(shore).toBeLessThan(0.03);
    expect(coverLift(1)).toBeGreaterThan(shore + 0.08);
  });

  it('keeps submerged ground free of grass and moss', () => {
    const cover = buildIsland(() => -2).children[1] as Mesh;
    expect(cover.geometry.getAttribute('position').count).toBe(0);
  });
});
