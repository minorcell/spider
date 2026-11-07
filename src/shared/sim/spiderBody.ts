import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LineSegments,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { DECK_Y } from '../config.js';
import {
  eyeMat,
  growShell,
  inkMat,
  inkSolidMat,
  spiderMat,
  tubeCrest,
  tubeGeo,
  tubeShell,
} from './parts.js';

const CEPH_REAR_Z = 0.36;
const CEPH_Y_SCALE = 0.18 / 0.55;
const CEPHALOTHORAX: readonly (readonly [number, number])[] = [
  [0.004, 0],
  [0.1, 0.06],
  [0.26, 0.16],
  [0.42, 0.28],
  [0.52, 0.38],
  [0.55, 0.48],
  [0.5, 0.6],
  [0.36, 0.72],
  [0.22, 0.82],
  [0.1, 0.9],
  [0.004, 0.94],
];

const ABDOMEN_FRONT_Z = 0.48;
const ABDOMEN_Y_SCALE = 0.32 / 0.46;
const ABDOMEN: readonly (readonly [number, number])[] = [
  [0.004, 0],
  [0.14, 0.08],
  [0.3, 0.2],
  [0.4, 0.36],
  [0.46, 0.54],
  [0.44, 0.72],
  [0.34, 0.9],
  [0.2, 1.04],
  [0.1, 1.14],
  [0.004, 1.22],
];

const EYES: readonly (readonly [number, number, number, number])[] = [
  [-0.15, 0.04, -0.01, 0.016],
  [-0.064, 0.02, -0.04, 0.03],
  [0.064, 0.02, -0.04, 0.03],
  [0.15, 0.04, -0.01, 0.016],
  [-0.12, 0.078, 0.02, 0.013],
  [-0.04, 0.086, 0.0, 0.015],
  [0.04, 0.086, 0.0, 0.015],
  [0.12, 0.078, 0.02, 0.013],
];

const eyeGeo = new SphereGeometry(1, 14, 10);
const podGeo = new SphereGeometry(1, 12, 8);
const podShell = growShell(podGeo, 0.16);
const fangGeo = new CylinderGeometry(0.0022, 0.007, 0.055, 8);
const fangShell = growShell(fangGeo, 0.002);
const spinGeo = new CylinderGeometry(0.0035, 0.011, 0.06, 8);
const spinShell = growShell(spinGeo, 0.0025);

const AHEAD = new Vector3(0, 0, -1);
const layDelta = new Vector3();
const layTurn = new Quaternion();

function spindle(
  profile: readonly (readonly [number, number])[],
  yScale: number,
  axisY: number,
  originZ: number,
  alongSign: -1 | 1,
): BufferGeometry {
  const geo = new LatheGeometry(
    profile.map(([radius, along]) => new Vector2(radius, along)),
    40,
  );
  geo.rotateX(alongSign === -1 ? -Math.PI / 2 : Math.PI / 2);
  geo.scale(1, yScale, 1);
  geo.translate(0, axisY, originZ);
  geo.computeVertexNormals();
  return geo;
}

function paper(parent: Object3D, geo: BufferGeometry, name: string): Mesh {
  const mesh = new Mesh(geo, spiderMat);
  mesh.name = name;
  mesh.add(new Mesh(growShell(geo, 0.006), inkSolidMat));
  parent.add(mesh);
  return mesh;
}

function addInk(parent: Object3D, flat: readonly number[], name: string): void {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flat, 3));
  const lines = new LineSegments(geometry, inkMat);
  lines.name = name;
  parent.add(lines);
}

function trace(
  profile: readonly (readonly [number, number])[],
  yScale: number,
  axisY: number,
  originZ: number,
  alongSign: number,
  xOf: (radius: number) => number,
  yLift: number,
): number[] {
  const flat: number[] = [];
  for (let i = 1; i < profile.length - 2; i++) {
    const [r0, a0] = profile[i];
    const [r1, a1] = profile[i + 1];
    flat.push(
      xOf(r0),
      axisY + r0 * yScale * yLift,
      originZ + alongSign * a0,
      xOf(r1),
      axisY + r1 * yScale * yLift,
      originZ + alongSign * a1,
    );
  }
  return flat;
}

function lay(parent: Object3D, from: Vector3, to: Vector3, radius: number, name: string): void {
  const group = new Group();
  group.name = name;
  layDelta.subVectors(to, from);
  const dist = layDelta.length();
  layDelta.multiplyScalar(1 / dist);
  group.position.copy(from);
  group.quaternion.copy(layTurn.setFromUnitVectors(AHEAD, layDelta));
  group.scale.set(radius, radius, dist);
  const mesh = new Mesh(tubeGeo, spiderMat);
  mesh.add(new Mesh(tubeShell, inkSolidMat));
  mesh.add(new LineSegments(tubeCrest, inkMat));
  group.add(mesh);
  parent.add(group);
}

function eyes(head: Group): void {
  for (const [x, y, z, radius] of EYES) {
    const mesh = new Mesh(eyeGeo, eyeMat);
    mesh.name = 'eye';
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(radius);
    head.add(mesh);
  }
}

function mouth(head: Group, side: number): void {
  const pod = new Mesh(podGeo, spiderMat);
  pod.name = 'chelicera';
  pod.position.set(side * 0.05, -0.042, -0.03);
  pod.scale.set(0.032, 0.05, 0.036);
  pod.add(new Mesh(podShell, inkSolidMat));
  head.add(pod);

  const fang = new Mesh(fangGeo, spiderMat);
  fang.name = 'fang';
  fang.position.set(side * 0.04, -0.04, -0.01);
  fang.rotation.x = -2.2;
  fang.add(new Mesh(fangShell, inkSolidMat));
  head.add(fang);
}

function palp(head: Group, side: number): void {
  const name = side < 0 ? 'pedipalp-left' : 'pedipalp-right';
  const base = new Vector3(side * 0.08, -0.02, 0.04);
  const mid = new Vector3(side * 0.12, -0.045, -0.02);
  const tip = new Vector3(side * 0.135, -0.06, -0.06);
  lay(head, base, mid, 0.016, name);
  lay(head, mid, tip, 0.01, `${name}-tip`);
}

function spinnerets(chassis: Group): void {
  const spots: readonly (readonly [number, number, number])[] = [
    [-0.035, DECK_Y - 0.02, 1.52],
    [0, DECK_Y - 0.05, 1.54],
    [0.035, DECK_Y - 0.02, 1.52],
  ];
  for (const [x, y, z] of spots) {
    const mesh = new Mesh(spinGeo, spiderMat);
    mesh.name = 'spinneret';
    mesh.position.set(x, y, z);
    mesh.rotation.x = Math.PI / 2;
    mesh.add(new Mesh(spinShell, inkSolidMat));
    chassis.add(mesh);
  }
}

export function buildSpiderBody(chassis: Group): Group {
  const ceph = spindle(CEPHALOTHORAX, CEPH_Y_SCALE, DECK_Y, CEPH_REAR_Z, -1);
  paper(chassis, ceph, 'cephalothorax');
  addInk(
    chassis,
    [
      ...trace(CEPHALOTHORAX, CEPH_Y_SCALE, DECK_Y, CEPH_REAR_Z, -1, () => 0, 1),
      ...trace(
        CEPHALOTHORAX,
        CEPH_Y_SCALE,
        DECK_Y,
        CEPH_REAR_Z,
        -1,
        (radius) => radius * 0.42,
        0.45,
      ),
      ...trace(
        CEPHALOTHORAX,
        CEPH_Y_SCALE,
        DECK_Y,
        CEPH_REAR_Z,
        -1,
        (radius) => -radius * 0.42,
        0.45,
      ),
      -0.07,
      0.93,
      -0.06,
      0,
      0.89,
      -0.12,
      0,
      0.89,
      -0.12,
      0.07,
      0.93,
      -0.06,
    ],
    'carapace-ink',
  );

  const waist = new CylinderGeometry(0.042, 0.09, 0.36, 14);
  waist.rotateX(Math.PI / 2);
  waist.translate(0, DECK_Y, 0.4);
  waist.computeVertexNormals();
  paper(chassis, waist, 'pedicel');

  const abdomenY = DECK_Y + 0.06;
  const abdomen = spindle(ABDOMEN, ABDOMEN_Y_SCALE, abdomenY, ABDOMEN_FRONT_Z, 1);
  paper(chassis, abdomen, 'abdomen');
  addInk(
    chassis,
    [
      ...trace(ABDOMEN, ABDOMEN_Y_SCALE, abdomenY, ABDOMEN_FRONT_Z, 1, () => 0, 1),
      -0.1,
      1.14,
      1.06,
      0,
      1.18,
      1.0,
      0,
      1.18,
      1.0,
      0.1,
      1.14,
      1.06,
      -0.08,
      1.08,
      1.24,
      0,
      1.12,
      1.18,
      0,
      1.12,
      1.18,
      0.08,
      1.08,
      1.24,
    ],
    'abdomen-ink',
  );
  spinnerets(chassis);

  const head = new Group();
  head.name = 'head';
  head.position.set(0, DECK_Y + 0.02, -0.52);
  chassis.add(head);
  eyes(head);
  mouth(head, -1);
  mouth(head, 1);
  palp(head, -1);
  palp(head, 1);
  return head;
}
