import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  Vector3,
  type Material,
} from 'three';
import { inkMat } from '@/src/client/rig/parts';

export { tubeGeometry } from '@/src/client/tubeGeometry';

export function lineFrom(flat: readonly number[], material: Material = inkMat): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flat, 3));
  return new LineSegments(geometry, material);
}

export function pushLine(out: number[], points: readonly Vector3[]): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

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
