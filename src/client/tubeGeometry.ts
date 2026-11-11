import type { BufferGeometry } from 'three';
import { tubeMesh } from '@/src/shared/mesh';
import type { Vec3 } from '@/src/shared/state';
import { meshGeometry } from '@/src/client/meshGeometry';

export function tubeGeometry(
  spine: readonly Vec3[],
  radiusAt: (t: number) => number,
  radial = 8,
): BufferGeometry {
  return meshGeometry(tubeMesh(spine, radiusAt, radial));
}
