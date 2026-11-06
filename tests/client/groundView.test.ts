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
  it('builds a paper surface and curved ink along the slope', () => {
    const height = (x: number, z: number): number => x * 0.1 + z * 0.2;
    const island = buildIsland(height);
    expect(island).toBeInstanceOf(Group);
    expect(island.children).toHaveLength(4);
    expect(island.children[0]).toBeInstanceOf(Mesh);
    const grid = island.children[1];
    const position = (grid as Mesh).geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    expect(position.getY(0)).toBeCloseTo(height(position.getX(0), position.getZ(0)) + 0.02);
    let bent = false;
    for (let i = 0; i < position.count; i += 2) {
      const dx = Math.abs(position.getX(i + 1) - position.getX(i));
      const dz = Math.abs(position.getZ(i + 1) - position.getZ(i));
      if (dx > 1e-4 && dz > 1e-4) bent = true;
    }
    expect(bent).toBe(true);
    const contours = island.children[2] as Group;
    expect(contours).toBeInstanceOf(Group);
    expect(contours.children).toHaveLength(2);
    const lines = (contours.children[0] as LineSegments).geometry.getAttribute('position');
    expect(lines.count).toBeGreaterThan(0);
    const water = island.children[3] as Mesh;
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
    const water = buildIsland(() => 0).children[3] as Mesh;
    const material = water.material as MeshBasicNodeMaterial;
    tickWater(12.5);
    expect(material.userData.uTime.value).toBe(12.5);
    tickWater(12.55);
    expect(material.userData.uTime.value).toBe(12.55);
    tickWater(1);
    expect(material.userData.uTime.value).toBe(1);
  });

  it('lays the same curves on flat ground', () => {
    const island = buildIsland(() => 1);
    const position = (island.children[1] as Mesh).geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    expect(position.getY(0)).toBeCloseTo(1.02);
  });

  it('draws contours across a saddle', () => {
    const height = (x: number, z: number): number => x * z * 0.01;
    const contours = buildIsland(height).children[2] as Group;
    const lines = (contours.children[0] as LineSegments).geometry.getAttribute('position');
    expect(lines.count).toBeGreaterThan(0);
  });
});
