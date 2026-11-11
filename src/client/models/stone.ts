import { Group, Mesh, MeshLambertMaterial, LineBasicMaterial } from 'three';
import { stoneParts } from '@/src/shared/stoneForm';
import type { Footprint } from '@/src/shared/state';
import { PALETTE } from '@/src/shared/config';
import { meshGeometry } from '@/src/client/meshGeometry';
import { mineralGrain, paintMineral } from '@/src/client/models/surface';
import { growShell, inkSolidMat } from '@/src/client/rig/parts';
import { buildGrass } from '@/src/client/grassMesh';
import { groupHeight, lineFrom } from '@/src/client/models/geometry';

const stoneMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  map: mineralGrain,
  bumpMap: mineralGrain,
  bumpScale: 0.025,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const inkMat = new LineBasicMaterial({ color: 0x625f55, transparent: true, opacity: 0.35 });

/** The same solid vertices drive the registered obstruction and ground support. */
export function buildStone(id: string, footprint: Footprint | undefined, bog: boolean): Group {
  const group = new Group();
  group.name = bog ? 'bog-stone' : 'stone';
  for (const [index, part] of stoneParts(id, footprint, bog).entries()) {
    const cluster = new Group();
    const geometry = meshGeometry(part.mesh);
    paintMineral(geometry, bog ? PALETTE.bogStone : PALETTE.stone, bog ? 0.9 : 0.32);
    const mesh = new Mesh(geometry, stoneMat);
    mesh.position.copy(part.position);
    mesh.rotation.y = part.rotation.y;
    mesh.add(new Mesh(growShell(geometry, part.skin), inkSolidMat));
    cluster.add(mesh);
    const cracks: number[] = [];
    const vertex = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal');
    // A few mineral seams follow the actual surface instead of floating over it.
    for (const row of [7, 12]) {
      for (let col = 2 + index; col < 9 + index; col++) {
        for (const at of [row * 33 + col, row * 33 + col + 1]) {
          cracks.push(
            vertex.getX(at) + normal.getX(at) * 0.002,
            vertex.getY(at) + normal.getY(at) * 0.002,
            vertex.getZ(at) + normal.getZ(at) * 0.002,
          );
        }
      }
    }
    const lines = lineFrom(cracks, inkMat);
    lines.position.copy(mesh.position);
    lines.rotation.y = mesh.rotation.y;
    cluster.add(lines);
    if (bog) {
      const tuft = buildGrass(0.45, index * 131 + 71, 'seed');
      tuft.position.set(part.position.x + part.size * 0.7, 0, part.position.z + part.size * 0.5);
      cluster.add(tuft);
    }
    group.add(cluster);
  }
  group.userData.height = groupHeight(group);
  return group;
}
