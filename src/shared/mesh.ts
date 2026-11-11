import type { Vec3 } from '@/src/shared/state';

/** Indexed geometry data shared by spatial queries and presentation adapters. */
export interface TriangleMesh {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
}

function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

export function sphereMesh(width: number, height: number): TriangleMesh {
  const position: number[] = [];
  const index: number[] = [];
  for (let row = 0; row <= height; row++) {
    const y = Math.cos((row / height) * Math.PI);
    const radius = Math.sqrt(1 - y * y);
    for (let col = 0; col <= width; col++) {
      const angle = (col / width) * Math.PI * 2;
      position.push(-radius * Math.cos(angle), y, radius * Math.sin(angle));
    }
  }
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const a = row * (width + 1) + col + 1;
      const b = a - 1,
        c = b + width + 1,
        d = a + width + 1;
      if (row > 0) index.push(a, b, d);
      if (row < height - 1) index.push(b, c, d);
    }
  }
  return {
    position: Float32Array.from(position),
    normal: Float32Array.from(position),
    index: Uint32Array.from(index),
  };
}

export function tubeMesh(
  spine: readonly Vec3[],
  radiusAt: (t: number) => number,
  radial = 8,
): TriangleMesh {
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < spine.length; i++) {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    const tangent = unit(next.x - prev.x, next.y - prev.y, next.z - prev.z);
    const side =
      Math.abs(tangent.y) > 0.92 ? unit(0, tangent.z, -tangent.y) : unit(-tangent.z, 0, tangent.x);
    const bin = unit(
      side.y * tangent.z - side.z * tangent.y,
      side.z * tangent.x - side.x * tangent.z,
      side.x * tangent.y - side.y * tangent.x,
    );
    const radius = radiusAt(i / (spine.length - 1));
    for (let k = 0; k < radial; k++) {
      const angle = (k / radial) * Math.PI * 2;
      const c = Math.cos(angle) * radius,
        s = Math.sin(angle) * radius;
      position.push(
        spine[i].x + side.x * c + bin.x * s,
        spine[i].y + side.y * c + bin.y * s,
        spine[i].z + side.z * c + bin.z * s,
      );
    }
  }
  for (let i = 0; i + 1 < spine.length; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k,
        b = i * radial + ((k + 1) % radial);
      const c = a + radial,
        d = b + radial;
      index.push(a, c, b, b, c, d);
    }
  }
  const start = position.length / 3;
  const first = spine[0],
    last = spine[spine.length - 1];
  position.push(first.x, first.y, first.z, last.x, last.y, last.z);
  const ring = (spine.length - 1) * radial;
  for (let k = 0; k < radial; k++) {
    const k2 = (k + 1) % radial;
    index.push(start, k, k2, start + 1, ring + k2, ring + k);
  }
  const positions = Float32Array.from(position);
  const indices = Uint32Array.from(index);
  return { position: positions, index: indices, normal: normals(positions, indices) };
}

function normals(position: Float32Array, index: Uint32Array): Float32Array {
  const result = new Float32Array(position.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3,
      b = index[i + 1] * 3,
      c = index[i + 2] * 3;
    const ux = position[c] - position[b],
      uy = position[c + 1] - position[b + 1],
      uz = position[c + 2] - position[b + 2];
    const vx = position[a] - position[b],
      vy = position[a + 1] - position[b + 1],
      vz = position[a + 2] - position[b + 2];
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    for (const at of [a, b, c]) {
      result[at] += x;
      result[at + 1] += y;
      result[at + 2] += z;
    }
  }
  for (let at = 0; at < result.length; at += 3) {
    const n = unit(result[at], result[at + 1], result[at + 2]);
    result.set([n.x, n.y, n.z], at);
  }
  return result;
}

export interface MeshPlacement {
  mesh: TriangleMesh;
  skin: number;
  position?: Vec3;
  scale?: Vec3;
  rotation?: Vec3;
}

/** Euler XYZ, matching the presentation adapter, without renderer-owned matrices. */
function place(x: number, y: number, z: number, item: MeshPlacement): Vec3 {
  if (item.scale) {
    x *= item.scale.x;
    y *= item.scale.y;
    z *= item.scale.z;
  }
  if (item.rotation) {
    const r = item.rotation;
    const cx = Math.cos(r.x),
      sx = Math.sin(r.x),
      cy = Math.cos(r.y),
      sy = Math.sin(r.y),
      cz = Math.cos(r.z),
      sz = Math.sin(r.z);
    const ax = cz * x - sz * y,
      ay = sz * x + cz * y;
    const bx = cy * ax + sy * z,
      bz = -sy * ax + cy * z;
    x = bx;
    y = cx * ay - sx * bz;
    z = sx * ay + cx * bz;
  }
  return {
    x: x + (item.position?.x ?? 0),
    y: y + (item.position?.y ?? 0),
    z: z + (item.position?.z ?? 0),
  };
}

interface Face {
  x: number;
  y: number;
  z: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  uy: number;
  vy: number;
}

/** Spatial support index over ordinary triangles. Any registered content may reuse it. */
export function meshSurface(
  items: readonly MeshPlacement[],
  cell = 0.25,
): (x: number, z: number) => number {
  const cells = new Map<string, Face[]>();
  for (const item of items) {
    const { position, normal, index } = item.mesh;
    const vertices: Vec3[] = [];
    for (let i = 0; i < position.length; i += 3) {
      const n = unit(normal[i], normal[i + 1], normal[i + 2]);
      vertices.push(
        place(
          Math.fround(position[i] + n.x * item.skin),
          Math.fround(position[i + 1] + n.y * item.skin),
          Math.fround(position[i + 2] + n.z * item.skin),
          item,
        ),
      );
    }
    for (let i = 0; i < index.length; i += 3) {
      const a = vertices[index[i]],
        b = vertices[index[i + 1]],
        c = vertices[index[i + 2]];
      const bx = b.x - a.x,
        by = b.y - a.y,
        bz = b.z - a.z;
      const cx = c.x - a.x,
        cy = c.y - a.y,
        cz = c.z - a.z;
      const det = bx * cz - bz * cx;
      if (det >= -1e-10) continue;
      const face = {
        x: a.x,
        y: a.y,
        z: a.z,
        ux: cz / det,
        uz: -cx / det,
        vx: -bz / det,
        vz: bx / det,
        uy: by,
        vy: cy,
      };
      const x0 = Math.floor(Math.min(a.x, b.x, c.x) / cell),
        x1 = Math.floor(Math.max(a.x, b.x, c.x) / cell);
      const z0 = Math.floor(Math.min(a.z, b.z, c.z) / cell),
        z1 = Math.floor(Math.max(a.z, b.z, c.z) / cell);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const key = `${x},${z}`;
          const bucket = cells.get(key) ?? [];
          bucket.push(face);
          cells.set(key, bucket);
        }
    }
  }
  return (x, z) => {
    let y = Number.NEGATIVE_INFINITY;
    for (const face of cells.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
      const dx = x - face.x,
        dz = z - face.z;
      const u = face.ux * dx + face.uz * dz,
        v = face.vx * dx + face.vz * dz;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      y = Math.max(y, face.y + u * face.uy + v * face.vy);
    }
    return y;
  };
}
