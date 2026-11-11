import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { BODY_RADIUS, moveCircle } from '@/src/shared/collision';
import { propBlocks } from '@/src/shared/world';
import { buildNest } from '@/src/client/nest';
import { nestDetailHeight, nestSolidSurface } from '@/src/shared/nestCollision';
import { NEST_DETAILS, nestPebbleMesh } from '@/src/shared/nestDetails';
import {
  NEST_DOOR,
  NEST_FLOOR,
  NEST_RI,
  NEST_RO,
  NEST_SCALE_XZ,
  NEST_SCALE_Y,
  nestRimRadius,
  nestSurface,
} from '@/src/shared/nestShape';

describe('nest solid surface', () => {
  it('keeps the pebble outline closed across matching seam and pole vertices', () => {
    const { position, normal } = nestPebbleMesh();
    const groups = new Map<string, number[]>();
    let duplicates = 0;
    for (let i = 0; i < position.length; i += 3) {
      const key = Array.from(position.subarray(i, i + 3), (value) => Math.round(value * 1e5)).join(
        ',',
      );
      const direction = Array.from(normal.subarray(i, i + 3));
      expect(Math.hypot(...direction)).toBeCloseTo(1, 5);
      const previous = groups.get(key);
      if (previous) {
        duplicates++;
        expect(direction).toEqual(previous);
      } else {
        groups.set(key, direction);
      }
    }
    expect(duplicates).toBeGreaterThan(0);
  });

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
        solid.name = `${part.name}:${nest.children.indexOf(part)}:${mesh === part ? 'base' : 'shell'}`;
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
      const hits = ray.intersectObjects(solids, false);
      const hit = hits[0];
      expect(hit).toBeDefined();
      const detail = nestDetailHeight(
        (at.x - origin.x) / NEST_SCALE_XZ,
        (at.z - origin.z) / NEST_SCALE_XZ,
      );
      const height = origin.y + detail * NEST_SCALE_Y;
      const nearby = hits
        .slice(0, 5)
        .map(
          (result) =>
            `${result.object.name} @ ${result.point.y.toFixed(5)} (face ${result.faceIndex}, normal ${result.face?.normal.y.toFixed(4)})`,
        );
      expect(height, nearby.join(', ')).toBeCloseTo(hit.point.y, 4);
      expect(nestSolidSurface(origin, at.x, at.z)).toBeCloseTo(
        Math.max(nestSurface(origin, at.x, at.z), hit.point.y),
        4,
      );
    }
    material.dispose();
    for (const solid of solids) solid.geometry.dispose();
  });

  it('matches the chamber floor, rear bank and doorway to shared support', () => {
    const nest = buildNest();
    const origin = { x: -4, y: 0.8, z: 7 };
    nest.position.copy(origin);
    nest.updateMatrixWorld(true);
    const floor = nest.getObjectByName('chamber-floor') as Mesh;
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));

    const rear = Math.PI / 2;
    const crest = nestRimRadius(rear);
    for (const [radius, angle] of [
      [0, NEST_DOOR],
      [0.015, NEST_DOOR],
      [0.8, 0.23],
      [NEST_RI - 0.02, rear],
      [NEST_RI + 0.02, rear],
      [(NEST_RI + crest) / 2, rear],
      [crest, rear],
      [crest + 0.03, rear],
      [(crest + NEST_RO) / 2, rear],
      [NEST_RO - 0.03, rear],
      [nestRimRadius(0.6) + 0.03, 0.6],
      [1.5, NEST_DOOR],
      [2.1, NEST_DOOR],
      [NEST_RO - 0.02, NEST_DOOR],
    ]) {
      const x = origin.x + radius * Math.cos(angle) * NEST_SCALE_XZ;
      const z = origin.z + radius * Math.sin(angle) * NEST_SCALE_XZ;
      ray.ray.origin.set(x, 10, z);
      const hit = ray.intersectObject(floor, false)[0];
      expect(hit, `radius ${radius}, angle ${angle}`).toBeDefined();
      expect
        .soft(hit.point.y, `radius ${radius}, angle ${angle}`)
        .toBeCloseTo(nestSurface(origin, x, z), 2);
    }
  });

  it('supports root tips beyond the soil rim', () => {
    const origin = { x: -3, y: 0.7, z: 8 };
    const outsideTips = NEST_DETAILS.roots
      .flatMap(({ spine }) => [spine[0], spine.at(-1)!])
      .filter(({ x, z }) => Math.hypot(x, z) > NEST_RO);
    expect(outsideTips.length).toBeGreaterThan(0);
    for (const tip of outsideTips) {
      const x = origin.x + tip.x * NEST_SCALE_XZ;
      const z = origin.z + tip.z * NEST_SCALE_XZ;
      expect(nestSurface(origin, x, z)).toBe(Number.NEGATIVE_INFINITY);
      expect(nestSolidSurface(origin, x, z)).toBeGreaterThan(origin.y);
    }
  });

  it('keeps the entrance open while the registered rear bank blocks walking', () => {
    const nest = { id: 'home', kind: 'nest', x: 6, y: 0.5, z: -9, stage: 0 };
    const blocks = propBlocks([nest]);
    const entrance = moveCircle(nest.x, nest.z - 5, 0, 5, BODY_RADIUS, { blocks });
    expect(entrance).toMatchObject({ x: nest.x, z: nest.z, halt: 'clear' });
    const rear = moveCircle(nest.x, nest.z, 0, 5, BODY_RADIUS, { blocks });
    expect(rear.halt).toBe('solid');
    expect(rear.z).toBeGreaterThan(nest.z);
    expect(rear.z).toBeLessThan(nest.z + 5);
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
