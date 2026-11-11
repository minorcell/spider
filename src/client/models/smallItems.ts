import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import { growShell, inkSolidMat } from '@/src/client/rig/parts';
import { mineralGrain, paintMineral } from '@/src/client/models/surface';

const berryMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  map: mineralGrain,
});
const scarMat = new MeshLambertMaterial({ color: 0x61566e });
const pebbleMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  map: mineralGrain,
  bumpMap: mineralGrain,
  bumpScale: 0.008,
});

export function buildBerry(progress: number, radius: number): Group {
  const group = new Group();
  const size = radius * Math.cbrt(Math.max(0.15, 1 - progress));
  const geometry = new SphereGeometry(size, 28, 18);
  const position = geometry.getAttribute('position');
  const colors: number[] = [];
  const bloom = new Color(0x9f9cb4),
    skin = new Color(0x685882),
    tint = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const angle = Math.atan2(z, x);
    const lobe = 0.98 + 0.02 * Math.cos(angle * 5);
    position.setXYZ(i, x * lobe, y - Math.max(0, y / size - 0.7) * size * 0.35, z * lobe);
    tint.copy(skin).lerp(bloom, 0.35 + 0.25 * Math.sin(angle * 3 + (y / size) * 4));
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const fruit = new Mesh(geometry, berryMat);
  fruit.name = 'berry-skin';
  fruit.position.y = size;
  fruit.add(new Mesh(growShell(geometry, 0.0015), inkSolidMat));
  group.add(fruit);
  const petals: number[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5;
    for (const [a, reach, lift] of [
      [angle + 0.35, 0.12, 0],
      [angle, 0.34, 0.04],
      [angle - 0.35, 0.12, 0],
    ]) {
      petals.push(Math.cos(a) * reach * size, (0.9 + lift) * size, Math.sin(a) * reach * size);
    }
  }
  const calyxGeometry = new BufferGeometry();
  calyxGeometry.setAttribute('position', new Float32BufferAttribute(petals, 3));
  calyxGeometry.computeVertexNormals();
  const calyx = new Mesh(calyxGeometry, scarMat);
  calyx.name = 'berry-calyx';
  fruit.add(calyx);
  return group;
}

export function buildPebble(seed: number, radius: number): Group {
  const geometry = new SphereGeometry(radius, 24, 16);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const grain = 0.95 + 0.045 * Math.sin((x / radius) * 5 + seed) * Math.cos((z / radius) * 4);
    position.setXYZ(i, x * grain, y * 0.72 * grain, z * 0.86 * grain);
  }
  geometry.computeVertexNormals();
  paintMineral(geometry, 0x9caaa5, 0.12);
  const mesh = new Mesh(geometry, pebbleMat);
  mesh.name = 'river-pebble';
  mesh.position.y = radius * 0.72;
  mesh.add(new Mesh(growShell(geometry, 0.0015), inkSolidMat));
  return new Group().add(mesh);
}
