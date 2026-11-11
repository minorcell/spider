import { meshGeometry } from '@/src/client/meshGeometry';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from 'three';
import {
  NEST_DETAILS,
  NEST_PEBBLE_SKIN,
  NEST_ROOT_SKIN,
  nestPebbleMesh,
  nestRootMesh,
} from '@/src/shared/nestDetails';
import { NEST_RO, NEST_SCALE_XZ, NEST_SCALE_Y, nestLocalHeight } from '@/src/shared/nestShape';
import {
  growShell,
  inkSolidMat,
  silkMat,
  soilMat,
  stemMat,
  stoneMat,
} from '@/src/client/rig/parts';
import { buildGrass } from '@/src/client/grassMesh';
import { lineFrom, pushLine } from '@/src/client/models/geometry';

const TAU = Math.PI * 2;

export function buildNest(): Group {
  const group = new Group();
  group.name = 'nest';
  const silk: number[] = [];
  const positions: number[] = [];
  const indices: number[] = [];
  const rings = 26;
  const angles = 128;

  for (let i = 0; i <= rings; i++) {
    const radius = 0.04 + (i / rings) * (NEST_RO - 0.04);
    for (let j = 0; j < angles; j++) {
      const angle = (j / angles) * TAU;
      positions.push(
        Math.cos(angle) * radius,
        nestLocalHeight(radius, angle),
        Math.sin(angle) * radius,
      );
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < angles; j++) {
      const a = i * angles + j;
      const b = (i + 1) * angles + j;
      const c = i * angles + ((j + 1) % angles);
      const d = (i + 1) * angles + ((j + 1) % angles);
      indices.push(a, c, b, c, d, b);
    }
  }
  const ground = new BufferGeometry();
  ground.setAttribute('position', new Float32BufferAttribute(positions, 3));
  ground.setIndex(indices);
  ground.computeVertexNormals();
  const floor = new Mesh(ground, soilMat);
  floor.name = 'chamber-floor';
  group.add(floor);

  for (const pebble of NEST_DETAILS.pebbles) {
    const geometry = meshGeometry(nestPebbleMesh());
    const stone = new Mesh(geometry, stoneMat);
    stone.name = 'pebble';
    stone.scale.copy(pebble.scale);
    stone.position.copy(pebble.position);
    stone.rotation.set(pebble.rotation.x, pebble.rotation.y, pebble.rotation.z);
    stone.add(new Mesh(growShell(geometry, NEST_PEBBLE_SKIN), inkSolidMat));
    group.add(stone);
  }

  for (const spine of NEST_DETAILS.roots) {
    const geometry = meshGeometry(nestRootMesh(spine));
    const root = new Mesh(geometry, stemMat);
    root.name = 'bank-root';
    root.add(new Mesh(growShell(geometry, NEST_ROOT_SKIN), inkSolidMat));
    group.add(root);
  }

  for (let k = 0; k < 38; k++) {
    const z = -1.45 + (k / 37) * 2.7;
    const half = Math.sqrt(Math.max(0, 1 - (z / 1.65) ** 2)) * 1.25;
    const thread: Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const x = -half + (i / 12) * half * 2;
      const r = Math.hypot(x, z);
      thread.push(
        new Vector3(
          x,
          nestLocalHeight(r, Math.atan2(z, x)) + 0.025,
          z + Math.sin(i * 0.8 + k) * 0.025,
        ),
      );
    }
    pushLine(silk, thread);
  }
  for (let k = 0; k < 12; k++) {
    const x = (k / 11 - 0.5) * 2.25;
    pushLine(silk, [
      new Vector3(x, 0.22, -0.8),
      new Vector3(x * 1.05, 0.13, -1.7),
      new Vector3(x * 1.15, 0.09, -2.8),
    ]);
  }

  const styles = ['thin', 'seed', 'broad'] as const;
  for (const { index: k, x, z } of NEST_DETAILS.tufts) {
    const tuft = buildGrass(0.55, 200 + k, styles[k % 3]);
    tuft.position.set(x, 0.01, z);
    group.add(tuft);
  }
  group.add(lineFrom(silk, silkMat));
  group.scale.set(NEST_SCALE_XZ, NEST_SCALE_Y, NEST_SCALE_XZ);
  return group;
}
