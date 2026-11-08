import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { buildNest } from '../../src/client/nest.js';
import { nestDetailHeight, nestSolidSurface } from '../../src/shared/nestCollision.js';
import { NEST_DETAILS } from '../../src/shared/nestDetails.js';
import {
  NEST_DOOR,
  NEST_FLOOR,
  NEST_RO,
  NEST_SCALE_XZ,
  NEST_SCALE_Y,
  nestSurface,
} from '../../src/shared/nestShape.js';

describe('nest solid surface', () => {
  it('matches raycast tops of every pebble and root, including their ink shells', () => {
    const nest = buildNest();
    const origin = { x: 7, y: 1.2, z: -5 };
    nest.position.copy(origin);
    nest.updateMatrixWorld(true);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const solids: Mesh[] = [];
    const points: Vector3[] = [];
    const point = new Vector3();
    for (const part of nest.children) {
      if (part.name !== 'pebble' && part.name !== 'bank-root') continue;
      part.traverse((node) => {
        const mesh = node as Mesh;
        const solid = new Mesh(mesh.geometry, material);
        solid.matrixWorld.copy(mesh.matrixWorld);
        solids.push(solid);
        const position = mesh.geometry.getAttribute('position');
        const indices = mesh.geometry.getIndex()!;
        for (let i = 0; i < indices.count; i += 33) {
          const at = new Vector3();
          for (let j = 0; j < 3; j++) {
            at.add(point.fromBufferAttribute(position, indices.getX(i + j)));
          }
          points.push(at.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld));
        }
      });
    }
    expect(solids).toHaveLength((NEST_DETAILS.pebbles.length + NEST_DETAILS.roots.length) * 2);
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    for (const at of points) {
      ray.ray.origin.set(at.x, 10, at.z);
      const hit = ray.intersectObjects(solids, false)[0];
      expect(hit).toBeDefined();
      const detail = nestDetailHeight(
        (at.x - origin.x) / NEST_SCALE_XZ,
        (at.z - origin.z) / NEST_SCALE_XZ,
      );
      expect(origin.y + detail * NEST_SCALE_Y).toBeCloseTo(hit.point.y, 4);
      expect(nestSolidSurface(origin, at.x, at.z)).toBeCloseTo(
        Math.max(nestSurface(origin, at.x, at.z), hit.point.y),
        4,
      );
    }
    material.dispose();
    for (const solid of solids) solid.geometry.dispose();
  });

  it('supports root tips beyond the soil rim', () => {
    const origin = { x: -3, y: 0.7, z: 8 };
    for (const spine of NEST_DETAILS.roots) {
      const tip = spine.at(-1)!;
      expect(Math.hypot(tip.x, tip.z)).toBeGreaterThan(NEST_RO);
      const x = origin.x + tip.x * NEST_SCALE_XZ;
      const z = origin.z + tip.z * NEST_SCALE_XZ;
      expect(nestSurface(origin, x, z)).toBe(Number.NEGATIVE_INFINITY);
      expect(nestSolidSurface(origin, x, z)).toBeGreaterThan(origin.y);
    }
  });

  it('preserves the floor and open doorway and ignores ground beyond the nest', () => {
    const origin = { x: 0, y: 0.02, z: 0 };
    expect(nestSolidSurface(origin, 0, 0)).toBeCloseTo(origin.y + NEST_FLOOR * NEST_SCALE_Y);
    expect(nestDetailHeight(0, 0)).toBe(Number.NEGATIVE_INFINITY);
    for (const radius of [1.5, 2, 2.7, NEST_RO]) {
      const x = Math.cos(NEST_DOOR) * radius;
      const z = Math.sin(NEST_DOOR) * radius;
      expect(nestDetailHeight(x, z)).toBe(Number.NEGATIVE_INFINITY);
      expect(nestSolidSurface(origin, x * NEST_SCALE_XZ, z * NEST_SCALE_XZ)).toBeCloseTo(
        nestSurface(origin, x * NEST_SCALE_XZ, z * NEST_SCALE_XZ),
      );
    }
    for (const [x, z] of [
      [-5, 0],
      [5, 0],
      [0, -5],
      [0, 5],
      [3.8, 3.8],
    ]) {
      expect(nestDetailHeight(x, z)).toBe(Number.NEGATIVE_INFINITY);
      expect(nestSolidSurface(origin, x * NEST_SCALE_XZ, z * NEST_SCALE_XZ)).toBe(
        Number.NEGATIVE_INFINITY,
      );
    }
  });
});
