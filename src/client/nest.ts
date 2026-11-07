import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { mulberry32 } from '../shared/noise.js';
import {
  NEST_DOOR,
  NEST_RO,
  NEST_SCALE_XZ,
  NEST_SCALE_Y,
  nestDoor,
  nestLocalHeight,
  nestRimRadius,
} from '../shared/nestShape.js';
import {
  growShell,
  inkSolidMat,
  silkMat,
  soilMat,
  stemMat,
  stoneMat,
} from '../shared/sim/parts.js';
import { buildGrass } from './grassMesh.js';
import { lineFrom, pushLine, tubeGeometry } from './models/geometry.js';

const TAU = Math.PI * 2;

export function buildNest(): Group {
  const group = new Group();
  group.name = 'nest';
  const rand = mulberry32(71);
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

  for (let k = 0; k < 15; k++) {
    const angle = NEST_DOOR + 0.68 + (k / 14) * (TAU - 1.36);
    const radius = nestRimRadius(angle);
    const geometry = new SphereGeometry(1, 10, 7);
    const stone = new Mesh(geometry, stoneMat);
    stone.name = 'pebble';
    stone.scale.set(0.4 + rand() * 0.18, 0.26 + rand() * 0.2, 0.32 + rand() * 0.18);
    stone.position.set(
      Math.cos(angle) * radius,
      nestLocalHeight(radius, angle) + 0.04,
      Math.sin(angle) * radius,
    );
    stone.rotation.set(rand() * 0.25, angle + rand() * 0.5, rand() * 0.2);
    stone.add(new Mesh(growShell(geometry, 0.025), inkSolidMat));
    group.add(stone);
  }

  for (let k = 0; k < 9; k++) {
    const angle = (k / 9) * TAU + 0.3;
    if (nestDoor(angle) > 0.2) continue;
    const spine: Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 1.4 + t * 1.8;
      const a = angle + Math.sin(t * 4 + k) * 0.08;
      spine.push(
        new Vector3(
          Math.cos(a) * r,
          nestLocalHeight(Math.min(r, NEST_RO), a) + 0.04,
          Math.sin(a) * r,
        ),
      );
    }
    const geometry = tubeGeometry(spine, (t) => 0.065 * (1 - t * 0.85), 7);
    const root = new Mesh(geometry, stemMat);
    root.name = 'bank-root';
    root.add(new Mesh(growShell(geometry, 0.006), inkSolidMat));
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
  for (let k = 0; k < 12; k++) {
    const angle = 0.1 + (k / 12) * TAU;
    if (nestDoor(angle) > 0.2) continue;
    const tuft = buildGrass(0.55, 200 + k, styles[k % 3]);
    const r = 2.95 + rand() * 0.35;
    tuft.position.set(Math.cos(angle) * r, 0.01, Math.sin(angle) * r);
    group.add(tuft);
  }
  group.add(lineFrom(silk, silkMat));
  group.scale.set(NEST_SCALE_XZ, NEST_SCALE_Y, NEST_SCALE_XZ);
  return group;
}
