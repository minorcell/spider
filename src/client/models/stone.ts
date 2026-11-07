import { BufferGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry, Vector3 } from 'three';
import { PALETTE } from '../../shared/config.js';
import { mulberry32 } from '../../shared/noise.js';
import { growShell, inkMat, inkSolidMat } from '../../shared/sim/parts.js';
import { buildGrass } from '../grassMesh.js';
import { groupHeight, lineFrom } from './geometry.js';

// 石头是压扁的低模球，顶面被一组正弦扰动推成不规则的坡棱；
// 轮廓用墨壳，石面上的几道裂纹顺着同一套扰动走，不会浮在表面外。

const stoneMat = new MeshLambertMaterial({
  color: PALETTE.stone,
  flatShading: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

/** 沼石泡在水和泥里，比岸上的石头暗半档。 */
const bogStoneMat = new MeshLambertMaterial({
  color: PALETTE.bogStone,
  flatShading: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

/** 苔藓的绿，比草叶深一点。 */
const mossMat = new MeshLambertMaterial({
  color: PALETTE.moss,
  flatShading: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

interface RockShape {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly phase: number;
}

/** 石头表面的起伏。墨线和顶点读同一个函数，裂纹才贴得住。 */
function swell(dir: Vector3, phase: number): number {
  return (
    1 +
    0.1 * Math.sin(dir.x * 4.7 + phase) +
    0.06 * Math.cos(dir.y * 5.3 - phase * 1.7) +
    0.05 * Math.sin((dir.x + dir.z) * 6.1 + phase * 0.7) +
    0.03 * Math.cos(dir.z * 9.2 + dir.x * 3.1)
  );
}

function rockGeometry(shape: RockShape): BufferGeometry {
  const geometry = new SphereGeometry(1, 9, 6);
  const position = geometry.getAttribute('position');
  const dir = new Vector3();
  for (let i = 0; i < position.count; i++) {
    dir.set(position.getX(i), position.getY(i), position.getZ(i));
    const r = swell(dir, shape.phase);
    position.setXYZ(i, dir.x * r * shape.sx, dir.y * r * shape.sy, dir.z * r * shape.sz);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** 表面的一条裂纹：从单位球的一条大圆弧投到石头表面。 */
function crease(shape: RockShape, u: Vector3, v: Vector3, from: number, to: number): number[] {
  const out: number[] = [];
  const dir = new Vector3();
  const prev = new Vector3();
  const steps = 9;
  for (let i = 0; i <= steps; i++) {
    const t = from + (to - from) * (i / steps);
    dir.copy(u).multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t)).normalize();
    const r = swell(dir, shape.phase) * 1.015;
    const point = new Vector3(dir.x * r * shape.sx, dir.y * r * shape.sy, dir.z * r * shape.sz);
    if (i > 0) out.push(prev.x, prev.y, prev.z, point.x, point.y, point.z);
    prev.copy(point);
  }
  return out;
}

function creaseBasis(rand: () => number): { u: Vector3; v: Vector3 } {
  const u = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
  const helper = Math.abs(u.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const v = new Vector3().crossVectors(u, helper).normalize();
  return { u, v };
}

/** 一块石头：主体、墨壳和几道裂纹。原点在脚下。 */
function boulder(rand: () => number, size: number, bog: boolean): Group {
  const group = new Group();
  const shape: RockShape = {
    sx: size * (0.85 + rand() * 0.3),
    sy: size * (bog ? 0.42 + rand() * 0.08 : 0.55 + rand() * 0.12),
    sz: size * (0.78 + rand() * 0.28),
    phase: rand() * 6.283,
  };
  const geometry = rockGeometry(shape);
  const mesh = new Mesh(geometry, bog ? bogStoneMat : stoneMat);
  mesh.position.y = shape.sy * (bog ? 0.62 : 0.74);
  mesh.rotation.y = rand() * 6.283;
  mesh.add(new Mesh(growShell(geometry, 0.014 * size + 0.006), inkSolidMat));
  group.add(mesh);

  const ink: number[] = [];
  const cracks = 3 + Math.floor(rand() * 2);
  for (let k = 0; k < cracks; k++) {
    const { u, v } = creaseBasis(rand);
    const start = rand() * 0.8;
    const span = 0.7 + rand() * 1.2;
    ink.push(...crease(shape, u, v, start, start + span));
  }
  const lines = lineFrom(ink, inkMat);
  lines.position.copy(mesh.position);
  lines.rotation.y = mesh.rotation.y;
  group.add(lines);

  if (bog) {
    // 苔藓：两三片压扁的绿纸贴在石头顶上。
    const patches = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < patches; k++) {
      const moss = new Mesh(new SphereGeometry(1, 8, 5), mossMat);
      moss.scale.set(
        size * (0.24 + rand() * 0.2),
        size * (0.05 + rand() * 0.04),
        size * (0.2 + rand() * 0.18),
      );
      const angle = rand() * 6.283;
      const reach = size * (0.1 + rand() * 0.28);
      moss.position.set(
        Math.cos(angle) * reach,
        mesh.position.y + shape.sy * (0.58 + rand() * 0.12),
        Math.sin(angle) * reach,
      );
      moss.rotation.y = rand() * 6.283;
      group.add(moss);
    }
    // 灯芯草：两小丛，从水面下抽出来。
    for (let k = 0; k < 2; k++) {
      const tuft = buildGrass(0.52 + rand() * 0.18, (rand() * 1e9) >>> 0, 'seed');
      const angle = rand() * 6.283;
      const reach = size * (0.62 + rand() * 0.25);
      tuft.position.set(Math.cos(angle) * reach, 0.01, Math.sin(angle) * reach);
      group.add(tuft);
    }
  }

  return group;
}

/**
 * 一组石头：一大两小。`size` 是主体的水平半径量级；
 * `bog` 让它变扁、长苔藓并在脚边抽两丛草，适合放在浅水边。
 */
export function buildStone(seed = 1, size = 1, bog = false): Group {
  const rand = mulberry32(seed >>> 0);
  const group = new Group();
  group.name = bog ? 'bog-stone' : 'stone';
  group.add(boulder(rand, size, bog));

  const satellites = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < satellites; k++) {
    const angle = rand() * 6.283;
    const reach = size * (0.75 + rand() * 0.35);
    const small = boulder(rand, size * (0.28 + rand() * 0.18), bog);
    small.position.set(Math.cos(angle) * reach, 0, Math.sin(angle) * reach);
    group.add(small);
  }

  group.userData.height = groupHeight(group);
  return group;
}
