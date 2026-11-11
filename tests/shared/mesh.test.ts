import { describe, expect, it } from 'vitest';
import { meshSurface, sphereMesh, tubeMesh } from '@/src/shared/mesh';

describe('renderer-independent registered support geometry', () => {
  it('finds the highest transformed surface and leaves empty space unoccupied', () => {
    const mesh = sphereMesh(12, 8);
    const support = meshSurface([
      { mesh, skin: 0, position: { x: 5, y: 2, z: -3 }, scale: { x: 2, y: 0.5, z: 1 } },
      { mesh, skin: 0, position: { x: 5, y: 4, z: -3 } },
    ]);
    expect(support(5, -3)).toBeCloseTo(5);
    expect(support(6.5, -3)).toBeGreaterThan(2);
    expect(support(8, -3)).toBe(-Infinity);
    expect([...structuredClone(mesh).position]).toEqual([...mesh.position]);
    expect([...structuredClone(mesh).index]).toEqual([...mesh.index]);
  });

  it('supports vertical tubes and handles coincident authoring points without NaNs', () => {
    const mesh = tubeMesh(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      () => 0.25,
    );
    const support = meshSurface([{ mesh, skin: 0 }]);
    expect(support(0, 0)).toBe(2);
    expect(support(0.5, 0)).toBe(-Infinity);
    const degenerate = tubeMesh(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      () => 0,
    );
    expect([...degenerate.position, ...degenerate.normal].every(Number.isFinite)).toBe(true);
    expect(meshSurface([{ mesh: degenerate, skin: 0 }])(0, 0)).toBe(-Infinity);
  });
});
