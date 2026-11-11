import { TREE_FORMS } from '@/src/shared/treeForm';
import { barkGrain } from '@/src/client/models/surface';
import {
  CatmullRomCurve3,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '@/src/shared/config';
import { mulberry32 } from '@/src/shared/noise';
import { growShell, inkMat, inkSolidMat, stemMat } from '@/src/client/rig/parts';
import { groupHeight, lineFrom, pushLine, tubeGeometry } from '@/src/client/models/geometry';

const TAU = Math.PI * 2;
const treeBarkMat = new MeshLambertMaterial({
  color: 0xc5af91,
  map: barkGrain,
  bumpMap: barkGrain,
  bumpScale: 0.035,
});

const foliageMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  side: DoubleSide,
  flatShading: false,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

/** Folded individual leaves give the canopy light gaps and a readable silhouette. */
function leafSprays(
  rand: () => number,
  clusters: readonly { at: Vector3; radius: number }[],
  scale: number,
  foliage: number,
  leaf: number,
): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const shades = [
    new Color(0x879c6e),
    new Color(leaf),
    new Color(PALETTE.leaf),
    new Color(0xb9bc8b),
  ];
  const axis = new Vector3();
  const side = new Vector3();
  const up = new Vector3();
  const center = new Vector3();
  const point = new Vector3();
  const tint = new Color();
  for (const { at, radius } of clusters) {
    for (let i = 0; i < Math.round(68 * foliage); i++) {
      const azimuth = rand() * TAU;
      const elevation = rand() * 2 - 1;
      const spread = radius * Math.cbrt(rand());
      const radial = Math.sqrt(1 - elevation * elevation);
      center.set(
        at.x + Math.cos(azimuth) * radial * spread,
        at.y + elevation * spread * 0.76,
        at.z + Math.sin(azimuth) * radial * spread,
      );
      const angle = azimuth + (rand() - 0.5) * 1.6;
      axis.set(Math.cos(angle), (rand() - 0.3) * 1.1, Math.sin(angle)).normalize();
      side.set(-axis.z, 0, axis.x).normalize();
      up.crossVectors(axis, side).normalize();
      const length = (0.14 + rand() * 0.16) * scale;
      const width = length * (0.3 + rand() * 0.13);
      const fold = width * 0.38;
      tint.copy(shades[Math.floor(rand() * shades.length)]).multiplyScalar(0.88 + rand() * 0.18);
      const first = positions.length / 3;
      // Base, left shoulder, folded midrib, right shoulder, pointed tip.
      for (const [along, across, lift] of [
        [-0.5, 0, 0],
        [0, -1, 0],
        [0.05, 0, 1],
        [0, 1, 0],
        [0.65, 0, -0.35],
      ]) {
        point
          .copy(center)
          .addScaledVector(axis, along * length)
          .addScaledVector(side, across * width)
          .addScaledVector(up, lift * fold);
        positions.push(point.x, point.y, point.z);
        const tone = lift === 1 ? 1.05 : 1;
        colors.push(tint.r * tone, tint.g * tone, tint.b * tone);
      }
      indices.push(
        first,
        first + 1,
        first + 2,
        first,
        first + 2,
        first + 3,
        first + 1,
        first + 4,
        first + 2,
        first + 2,
        first + 4,
        first + 3,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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

export function buildTree(
  seed = 1,
  height = 3.4,
  form: {
    girth: number;
    spread: number;
    foliage: number;
    leaf: number;
    name: string;
  } = TREE_FORMS[0],
): Group {
  const rand = mulberry32(seed >>> 0);
  const group = new Group();
  group.name = 'tree';
  group.userData.form = form.name;
  const s = height / 3.4;
  const lean = (rand() - 0.5) * 0.12 * s;
  const sway = (rand() - 0.5) * 0.12 * s;
  const trunkTop = height * (0.55 + rand() * 0.08);
  const trunkBase = (0.07 + height * 0.022) * form.girth;
  const trunkTopRadius = (0.028 + height * 0.006) * form.girth;

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

  // Root flares and secondary branches share the same batched bark material.
  for (let root = 0; root < 5; root++) {
    const angle = (root / 5) * TAU + rand() * 0.4;
    const reach = trunkBase * (2.8 + rand() * 0.7);
    const spine = [
      new Vector3(0, trunkBase * 0.65, 0),
      new Vector3(Math.cos(angle) * reach * 0.4, trunkBase * 0.12, Math.sin(angle) * reach * 0.4),
      new Vector3(Math.cos(angle) * reach, -0.08, Math.sin(angle) * reach),
    ];
    const geometry = tubeGeometry(
      new CatmullRomCurve3(spine).getPoints(10),
      (t) => trunkBase * 0.55 * (0.02 + Math.pow(1 - t, 1.4)),
      10,
    );
    group.add(new Mesh(geometry, stemMat));
  }

  const branchCount = 4 + Math.floor(rand() * 2);
  const tips: Vector3[] = [];
  for (let b = 0; b < branchCount; b++) {
    const t = 0.46 + rand() * 0.26;
    const base = trunkCurve.getPointAt(t);
    const angle = (b / branchCount) * TAU + rand() * 0.9;
    const reach = height * (0.2 + rand() * 0.15) * form.spread;
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
    const branchRadius = (0.032 + 0.02 * s) * form.girth;
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
    for (let twig = 0; twig < 2; twig++) {
      const start = curve.getPointAt(0.62 + twig * 0.18);
      const fan = angle + (twig === 0 ? -0.8 : 0.75);
      const end = start
        .clone()
        .add(new Vector3(Math.cos(fan) * reach * 0.58, rise * 0.4, Math.sin(fan) * reach * 0.58));
      const geometry = tubeGeometry(
        [
          start,
          start
            .clone()
            .lerp(end, 0.55)
            .add(new Vector3(0, 0.05 * s, 0)),
          end,
        ],
        (u) => branchRadius * 0.5 * (1 - u * 0.9),
        5,
      );
      group.add(new Mesh(geometry, stemMat));
      tips.push(end);
    }
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
  const canopy = new Mesh(leafSprays(rand, blobs, s, form.foliage, form.leaf), foliageMat);
  canopy.name = 'crown';
  group.add(canopy);

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
      if (node.material === stemMat) {
        const position = geometry.getAttribute('position');
        const uv: number[] = [];
        for (let i = 0; i < position.count; i++)
          uv.push(
            (Math.atan2(position.getZ(i), position.getX(i)) / TAU) * 3,
            position.getY(i) * 0.75,
          );
        geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      } else geometry.deleteAttribute('uv');
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
    [stems, treeBarkMat, 'trunk'],
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
