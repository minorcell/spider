import type { Vec3 } from '@/src/shared/state';
import { meshNormals, sphereMesh, tubeMesh } from '@/src/shared/mesh';
import { mulberry32 } from '@/src/shared/noise';
import { NEST_RO, nestLocalHeight, nestRimRadius } from '@/src/shared/nestShape';

export interface NestRoot {
  readonly spine: readonly Vec3[];
  readonly radius: number;
}

function layout() {
  const rand = mulberry32(71);
  // Stones are embedded in the banks, with a clear, low entrance in the foreground.
  const pebbles = [0.06, 0.34, 0.84, 1.4, 1.77, 2.21, 2.7, 3.08].map((angle) => {
    const radius = nestRimRadius(angle) + 0.12 + rand() * 0.3;
    return {
      scale: { x: 0.19 + rand() * 0.17, y: 0.14 + rand() * 0.13, z: 0.2 + rand() * 0.16 },
      position: {
        x: Math.cos(angle) * radius,
        y: nestLocalHeight(radius, angle) - 0.04,
        z: Math.sin(angle) * radius,
      },
      rotation: { x: rand() * 0.4, y: angle + rand(), z: rand() * 0.3 },
    };
  });
  // An asymmetric parent root comes from the back-right bank. Its offshoots
  // branch from that same spine and sink into the soil instead of making a fence.
  function rootPath(points: readonly (readonly [number, number])[], radius: number): NestRoot {
    const spine: Vec3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[i];
      const c = points[i + 1];
      const d = points[Math.min(points.length - 1, i + 2)];
      for (let k = 0; k < 8; k++) {
        const t = k / 8;
        const sample = (axis: number) =>
          0.5 *
          (2 * b[axis] +
            (-a[axis] + c[axis]) * t +
            (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t +
            (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t);
        const x = sample(0),
          z = sample(1);
        const r = Math.hypot(x, z),
          angle = Math.atan2(z, x);
        spine.push({ x, y: nestLocalHeight(Math.min(r, NEST_RO), angle) + 0.018, z });
      }
    }
    const [x, z] = points[points.length - 1];
    spine.push({ x, y: nestLocalHeight(Math.min(Math.hypot(x, z), NEST_RO), Math.atan2(z, x)), z });
    return { radius, spine };
  }
  const roots: NestRoot[] = [
    rootPath(
      [
        [2.65, 2.05],
        [1.82, 2.05],
        [0.8, 2.32],
        [-0.38, 2.13],
        [-1.65, 1.5],
        [-2.4, 0.9],
      ],
      0.34,
    ),
    rootPath(
      [
        [1.82, 2.05],
        [1.98, 1.66],
        [2.18, 0.94],
        [2.58, 0.15],
        [3.2, -0.2],
      ],
      0.18,
    ),
    rootPath(
      [
        [0.8, 2.32],
        [0.65, 1.95],
        [0.24, 1.66],
        [-0.2, 1.49],
      ],
      0.125,
    ),
    rootPath(
      [
        [-0.38, 2.13],
        [-1.05, 2.51],
        [-1.88, 2.65],
        [-2.7, 2.3],
      ],
      0.15,
    ),
    rootPath(
      [
        [-1.65, 1.5],
        [-1.92, 1.06],
        [-2.12, 0.43],
        [-2.78, -0.08],
        [-3.25, 0.05],
      ],
      0.095,
    ),
    rootPath(
      [
        [2.18, 0.94],
        [2.73, 1.1],
        [3.3, 0.83],
      ],
      0.065,
    ),
    rootPath(
      [
        [-1.05, 2.51],
        [-0.74, 2.86],
        [-0.91, 3.2],
      ],
      0.06,
    ),
  ];
  const tufts = [0.1, 0.45, 0.9, 1.3, 1.7, 2.2, 2.7, 3.04].map((angle, index) => {
    const radius = 2.8 + rand() * 0.3;
    return { index, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
  });
  return { pebbles, roots, tufts };
}

export const NEST_DETAILS = layout();
export const NEST_PEBBLE_SKIN = 0.012;
export const NEST_ROOT_SKIN = 0.004;

export function nestPebbleMesh() {
  const mesh = sphereMesh(14, 10);
  for (let i = 0; i < mesh.position.length; i += 3) {
    const x = mesh.position[i],
      y = mesh.position[i + 1],
      z = mesh.position[i + 2];
    const swell = 1 + 0.11 * Math.sin(x * 5.2 + z * 3.1) + 0.065 * Math.cos(y * 6.7 - x * 2.8);
    mesh.position[i] = x * swell + y * 0.09;
    mesh.position[i + 1] = y * swell;
    mesh.position[i + 2] = z * swell * (1 + x * 0.07);
  }
  mesh.normal = meshNormals(mesh.position, mesh.index);
  // UV-sphere seam and pole duplicates must share normals so the ink skin stays closed.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < mesh.position.length; i += 3) {
    const key = [mesh.position[i], mesh.position[i + 1], mesh.position[i + 2]]
      .map((n) => Math.round(n * 1e5))
      .join(',');
    const group = groups.get(key) ?? [];
    group.push(i);
    groups.set(key, group);
  }
  for (const indices of groups.values()) {
    let x = 0,
      y = 0,
      z = 0;
    for (const at of indices) {
      x += mesh.normal[at];
      y += mesh.normal[at + 1];
      z += mesh.normal[at + 2];
    }
    const length = Math.hypot(x, y, z);
    for (const at of indices) mesh.normal.set([x / length, y / length, z / length], at);
  }
  return mesh;
}

export function nestRootMesh(root: NestRoot) {
  return tubeMesh(
    root.spine,
    (t) => root.radius * (0.025 + 0.975 * Math.pow(1 - t, 1.15)) * (1 + 0.13 * Math.sin(t * 25)),
    10,
  );
}
