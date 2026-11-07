import {
  CatmullRomCurve3,
  Group,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../shared/config.js';
import { mulberry32 } from '../../shared/noise.js';
import { growShell, inkMat, inkSolidMat, stemMat } from '../../shared/sim/parts.js';
import { groupHeight, lineFrom, pushLine, tubeGeometry } from './geometry.js';

const TAU = Math.PI * 2;

const foliageMat = new MeshLambertMaterial({
  color: PALETTE.leaf,
  flatShading: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

const crownTemplate = new SphereGeometry(1, 9, 6);
const crownPositions = crownTemplate.getAttribute('position');
const crownVertexIds: number[] = [];
const crownIds = new Map<string, number>();
for (let i = 0; i < crownPositions.count; i++) {
  const key = `${crownPositions.getX(i).toFixed(3)},${crownPositions.getY(i).toFixed(3)},${crownPositions.getZ(i).toFixed(3)}`;
  if (!crownIds.has(key)) crownIds.set(key, crownIds.size);
  crownVertexIds.push(crownIds.get(key)!);
}

function blobGeometry(rand: () => number, radius: number, squash: number): SphereGeometry {
  const geometry = crownTemplate.clone();
  const position = geometry.getAttribute('position');
  const scales = Array.from({ length: crownIds.size }, () => 0.84 + rand() * 0.3);
  for (let i = 0; i < position.count; i++) {
    const scale = scales[crownVertexIds[i]] * radius;
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * scale * squash,
      position.getZ(i) * scale,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function blob(rand: () => number, at: Vector3, radius: number, squash: number): Mesh {
  const geometry = blobGeometry(rand, radius, squash);
  const mesh = new Mesh(geometry, foliageMat);
  mesh.position.copy(at);
  mesh.rotation.y = rand() * TAU;
  mesh.add(new Mesh(growShell(geometry, 0.012 + radius * 0.018), inkSolidMat));
  return mesh;
}

function rootInk(rand: () => number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * TAU + rand() * 0.7;
    const reach = 0.3 + rand() * 0.35;
    const points: Vector3[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const r = reach * t;
      points.push(
        new Vector3(
          Math.cos(angle) * r,
          0.045 * (1 - t) + 0.006 + Math.sin(Math.PI * t) * 0.02,
          Math.sin(angle) * r,
        ),
      );
    }
    pushLine(out, points);
  }
  return out;
}

export function buildTree(seed = 1, height = 3.4): Group {
  const rand = mulberry32(seed >>> 0);
  const group = new Group();
  group.name = 'tree';
  const s = height / 3.4;
  const lean = (rand() - 0.5) * 0.5 * s;
  const sway = (rand() - 0.5) * 0.4 * s;
  const trunkTop = height * (0.55 + rand() * 0.08);
  const trunkBase = 0.07 + height * 0.022;
  const trunkTopRadius = 0.028 + height * 0.006;

  const trunkCurve = new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(lean * 0.1, trunkTop * 0.3, sway * 0.08),
    new Vector3(lean * 0.45, trunkTop * 0.66, sway * 0.4),
    new Vector3(lean, trunkTop, sway),
  ]);
  const trunkSpine = trunkCurve.getPoints(9);
  const radiusAt = (t: number): number =>
    (trunkBase * (1 - t) + trunkTopRadius) * (1 + 0.06 * Math.sin(t * 9 + seed));
  const trunkGeometry = tubeGeometry(trunkSpine, radiusAt, 9);
  const trunk = new Mesh(trunkGeometry, stemMat);
  trunk.name = 'trunk';
  trunk.add(new Mesh(growShell(trunkGeometry, 0.01), inkSolidMat));
  group.add(trunk);

  const bark: number[] = [];
  for (let k = 0; k < 3; k++) {
    const phi = (k / 3) * TAU + rand() * 0.7;
    const points: Vector3[] = [];
    for (let i = 0; i < trunkSpine.length; i++) {
      const t = i / (trunkSpine.length - 1);
      const r = radiusAt(t) * 1.05;
      const a = phi + t * 0.7;
      points.push(
        new Vector3(
          trunkSpine[i].x + Math.cos(a) * r,
          trunkSpine[i].y,
          trunkSpine[i].z + Math.sin(a) * r,
        ),
      );
    }
    pushLine(bark, points);
  }
  bark.push(...rootInk(rand));
  group.add(lineFrom(bark, inkMat));

  const branchCount = 3 + Math.floor(rand() * 2);
  const tips: Vector3[] = [];
  for (let b = 0; b < branchCount; b++) {
    const t = 0.46 + rand() * 0.26;
    const base = trunkCurve.getPointAt(t);
    const angle = (b / branchCount) * TAU + rand() * 0.9;
    const reach = height * (0.2 + rand() * 0.15);
    const rise = height * (0.16 + rand() * 0.14);
    const tip = new Vector3(
      base.x + Math.cos(angle) * reach,
      base.y + rise,
      base.z + Math.sin(angle) * reach,
    );
    const curve = new CatmullRomCurve3([
      base,
      new Vector3(
        base.x + Math.cos(angle) * reach * 0.45,
        base.y + rise * 0.42,
        base.z + Math.sin(angle) * reach * 0.45,
      ),
      new Vector3(
        base.x + Math.cos(angle) * reach * 0.85,
        base.y + rise * 0.86,
        base.z + Math.sin(angle) * reach * 0.85,
      ),
      tip,
    ]);
    const spine = curve.getPoints(5);
    const branchRadius = 0.032 + 0.02 * s;
    const geometry = tubeGeometry(spine, (u) => branchRadius * (1 - u * 0.82), 7);
    const limb = new Mesh(geometry, stemMat);
    limb.add(new Mesh(growShell(geometry, 0.006), inkSolidMat));
    group.add(limb);
    const crest: number[] = [];
    pushLine(
      crest,
      spine.map(
        (point, i) => new Vector3(point.x, point.y + branchRadius * (1 - i / 5) * 0.9, point.z),
      ),
    );
    group.add(lineFrom(crest, inkMat));
    tips.push(tip);
  }

  const crown = trunkCurve.getPointAt(1);
  const blobs: { at: Vector3; radius: number }[] = [
    { at: new Vector3(crown.x, crown.y + 0.16 * s, crown.z), radius: 0.62 * s },
  ];
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * TAU + 0.5 + rand() * 0.35;
    const distance = (0.34 + rand() * 0.24) * s;
    blobs.push({
      at: new Vector3(
        crown.x + Math.cos(angle) * distance,
        crown.y + (0.02 + rand() * 0.34) * s,
        crown.z + Math.sin(angle) * distance,
      ),
      radius: (0.4 + rand() * 0.18) * s,
    });
  }
  for (const tip of tips) {
    blobs.push({
      at: new Vector3(tip.x, tip.y + 0.08 * s, tip.z),
      radius: (0.34 + rand() * 0.14) * s,
    });
  }
  for (const item of blobs) group.add(blob(rand, item.at, item.radius, 0.86));

  group.updateMatrixWorld(true);
  const stems: (typeof trunkGeometry)[] = [];
  const leaves: (typeof trunkGeometry)[] = [];
  const shells: (typeof trunkGeometry)[] = [];
  const lines: number[] = [];
  const point = new Vector3();
  group.traverse((node) => {
    if (node instanceof Mesh) {
      const geometry = node.geometry;
      geometry.applyMatrix4(node.matrixWorld);
      geometry.deleteAttribute('uv');
      const batch =
        node.material === foliageMat ? leaves : node.material === stemMat ? stems : shells;
      batch.push(geometry);
    } else if (node instanceof LineSegments) {
      const positions = node.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
        lines.push(point.x, point.y, point.z);
      }
      node.geometry.dispose();
    }
  });
  group.clear();
  for (const [geometries, material, name] of [
    [stems, stemMat, 'trunk'],
    [leaves, foliageMat, 'crown'],
    [shells, inkSolidMat, 'outline'],
  ] as const) {
    const mesh = new Mesh(mergeGeometries(geometries)!, material);
    mesh.name = name;
    group.add(mesh);
    for (const geometry of geometries) geometry.dispose();
  }
  group.add(lineFrom(lines, inkMat));
  group.userData.height = groupHeight(group);
  return group;
}
