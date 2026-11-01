import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
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
  it('builds a paper surface and a grid of ink lines', () => {
    const height = (x: number, z: number): number => x * 0.1 + z * 0.2;
    const island = buildIsland(height);
    expect(island).toBeInstanceOf(Group);
    expect(island.children).toHaveLength(2);
    expect(island.children[0]).toBeInstanceOf(Mesh);
    const grid = island.children[1];
    const position = (grid as Mesh).geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    expect(position.getY(0)).toBeCloseTo(height(position.getX(0), position.getZ(0)) + 0.02);
  });
});
