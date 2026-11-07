import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  Vector3,
  type Material,
} from 'three';
import { inkMat } from '../../shared/sim/parts.js';

const TAU = Math.PI * 2;

/** 浮点坐标转墨线，和苹果、巢穴用同一套语言。 */
export function lineFrom(flat: readonly number[], material: Material = inkMat): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flat, 3));
  return new LineSegments(geometry, material);
}

/** 沿骨架环出一根渐细的圆杆：树干、树枝都用它。 */
export function tubeGeometry(
  spine: readonly Vector3[],
  radiusAt: (t: number) => number,
  radial = 8,
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const tangent = new Vector3();
  const up = new Vector3();
  const side = new Vector3();
  const bin = new Vector3();
  const point = new Vector3();
  const rings = spine.length;

  for (let i = 0; i < rings; i++) {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(rings - 1, i + 1)];
    tangent.subVectors(next, prev).normalize();
    if (Math.abs(tangent.y) > 0.92) up.set(1, 0, 0);
    else up.set(0, 1, 0);
    side.crossVectors(tangent, up).normalize();
    bin.crossVectors(side, tangent).normalize();
    const radius = radiusAt(i / (rings - 1));
    for (let k = 0; k < radial; k++) {
      const angle = (k / radial) * TAU;
      point
        .copy(spine[i])
        .addScaledVector(side, Math.cos(angle) * radius)
        .addScaledVector(bin, Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
    }
  }

  for (let i = 0; i + 1 < rings; i++) {
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      const a = i * radial + k;
      const b = i * radial + k2;
      const c = (i + 1) * radial + k;
      const d = (i + 1) * radial + k2;
      indices.push(a, c, b, b, c, d);
    }
  }

  // 两端封口，枝梢伸进树冠时不会从管口看见背面。
  const start = positions.length / 3;
  positions.push(spine[0].x, spine[0].y, spine[0].z);
  const end = positions.length / 3;
  positions.push(spine[rings - 1].x, spine[rings - 1].y, spine[rings - 1].z);
  const last = (rings - 1) * radial;
  for (let k = 0; k < radial; k++) {
    const k2 = (k + 1) % radial;
    indices.push(start, k2, k);
    indices.push(end, last + k, last + k2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** 把一条折线压进墨线数组。 */
export function pushLine(out: number[], points: readonly Vector3[]): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

/** 一件模型从脚到顶的高度，给标签和镜头用。 */
export function groupHeight(group: Group): number {
  group.updateMatrixWorld(true);
  const at = new Vector3();
  let top = 0;
  group.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.computeBoundingBox();
    const box = node.geometry.boundingBox!;
    node.getWorldPosition(at);
    top = Math.max(top, at.y + box.max.y * node.scale.y);
  });
  return top;
}
