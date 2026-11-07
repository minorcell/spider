import { describe, expect, it } from 'vitest';
import { Group, LineSegments, Mesh } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { buildIsland, groundGeometry, tickWater } from '../../src/client/groundView.js';
import { TERRAIN } from '../../src/shared/terrain.js';

describe('groundGeometry', () => {
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

  it('keeps submerged ground free of grass and moss', () => {
    const cover = buildIsland(() => -2).children[1] as Mesh;
    expect(cover.geometry.getAttribute('position').count).toBe(0);
  });
});
