import { describe, expect, it } from 'vitest';
import { Group, LineSegments, Mesh } from 'three';
import { buildIsland, groundGeometry } from '../../src/client/groundView.js';

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
    expect(island.children).toHaveLength(3);
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
