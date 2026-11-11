import { BufferAttribute, BufferGeometry } from 'three';
import type { TriangleMesh } from '@/src/shared/mesh';

export function meshGeometry(mesh: TriangleMesh): BufferGeometry {
  return new BufferGeometry()
    .setAttribute('position', new BufferAttribute(mesh.position, 3))
    .setAttribute('normal', new BufferAttribute(mesh.normal, 3))
    .setIndex(new BufferAttribute(mesh.index, 1));
}
