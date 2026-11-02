import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  Vector3,
  type Material,
} from 'three';
import { mulberry32 } from '../shared/noise.js';
import { inkMat, paperMat, silkMat, soilMat } from '../shared/sim/parts.js';
import { buildGrass } from './grassMesh.js';

// 巢穴是一圈土丘：背后堆得高、门口压得低，中间是一个浅坑。
// 坑底织一张收在坑里的网，辐条拉上穴壁；坑口的丝线垂进窝里。
// 土丘整体放大到 1.35 倍，好让蜘蛛的八条腿在坑里站得开。

const TAU = Math.PI * 2;
const SCALE = 1.35;

/** 0 在门口，1 在背后。 */
function back(a: number): number {
  return 0.5 + 0.5 * Math.sin(a);
}

/** 把角度收进 -π..π。 */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 丘顶离圆心多远。背后堆得更开。 */
function rimRadius(a: number): number {
  return (
    1.98 + 0.5 * Math.pow(back(a), 1.4) + 0.1 * Math.sin(3 * a + 0.6) + 0.05 * Math.sin(7 * a + 2.1)
  );
}

/** 丘顶多高。门口放低，背后垒高。 */
function rimHeight(a: number): number {
  return (
    0.4 +
    1.22 * Math.pow(back(a), 1.5) +
    0.06 * Math.sin(2 * a + 1.2) +
    0.035 * Math.sin(5 * a + 0.3)
  );
}

function segment(out: number[], a: Vector3, b: Vector3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function lineFrom(flat: readonly number[], material: Material = inkMat): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flat, 3));
  return new LineSegments(geometry, material);
}

/** 一颗小石子：削过的十二面体，压扁一点。 */
function pebble(x: number, z: number, size: number, rand: () => number): Mesh {
  const geometry = new DodecahedronGeometry(1, 0);
  const position = geometry.getAttribute('position');
  const wobble = 0.7 + rand() * 0.5;
  for (let i = 0; i < position.count; i++) {
    const s = 0.82 + rand() * 0.36;
    position.setXYZ(
      i,
      position.getX(i) * s,
      position.getY(i) * s * 0.7 * wobble,
      position.getZ(i) * s,
    );
  }
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, paperMat);
  mesh.scale.setScalar(size);
  mesh.position.set(x, size * 0.32, z);
  mesh.rotation.y = rand() * TAU;
  mesh.add(new LineSegments(new EdgesGeometry(geometry, 12), inkMat));
  return mesh;
}

/** 一根拴丝的小木桩。 */
function peg(x: number, z: number): Mesh {
  const geometry = new CylinderGeometry(0.012, 0.02, 0.16, 4);
  const mesh = new Mesh(geometry, paperMat);
  mesh.position.set(x, 0.06, z);
  mesh.add(new LineSegments(new EdgesGeometry(geometry, 1), inkMat));
  return mesh;
}

export { buildNest };

/** 土丘、穴壁、蛛网和门口。 */
function buildNest(): Group {
  const group = new Group();
  const flat: number[] = [];
  const ink: number[] = [];
  const silk: number[] = [];
  const rand = mulberry32(71);
  const ANGLES = 128;
  const RINGS = 26;
  const RO = 3.1;
  const RI = 1.4;
  const DOOR = -Math.PI / 2;
  const DOOR_HALF = 0.42;
  const FLOOR = 0.16;

  // 背后高、门口低：像在坡脚掏出来的洞。
  const door = (a: number): number => {
    const d = Math.abs(wrap(a - DOOR));
    return smoothstep(DOOR_HALF + 0.16, DOOR_HALF - 0.03, d);
  };

  const height = (r: number, a: number): number => {
    const rr = rimRadius(a);
    const hh = rimHeight(a);
    let y: number;
    if (r <= RI) {
      y = FLOOR + 0.03 * (r / RI) ** 2;
    } else if (r <= rr) {
      const t = (r - RI) / (rr - RI);
      y = FLOOR + (hh - FLOOR) * Math.pow(t, 1.3);
    } else {
      const t = (r - rr) / (RO - rr);
      y = hh * Math.pow(1 - t, 1.2);
    }
    const open = door(a) * smoothstep(1.02, 1.5, r);
    return y * (1 - open) + (0.055 + 0.012 * (r / RO)) * open;
  };

  for (let i = 0; i <= RINGS; i++) {
    const r = 0.04 + (i / RINGS) * (RO - 0.04);
    for (let j = 0; j < ANGLES; j++) {
      const a = (j / ANGLES) * TAU;
      flat.push(Math.cos(a) * r, height(r, a), Math.sin(a) * r);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < ANGLES; j++) {
      const j2 = (j + 1) % ANGLES;
      const a = i * ANGLES + j;
      const b = (i + 1) * ANGLES + j;
      const c = i * ANGLES + j2;
      const d = (i + 1) * ANGLES + j2;
      indices.push(a, c, b, c, d, b);
    }
  }
  const soil = new BufferGeometry();
  soil.setAttribute('position', new Float32BufferAttribute(flat, 3));
  soil.setIndex(indices);
  group.add(new Mesh(soil, soilMat));

  // 土坡上的短抓痕，像被刨过。
  for (let k = 0; k < 90; k++) {
    const a = rand() * TAU;
    const r = 1.55 + rand() * (RO - 1.75);
    if (door(a) > 0.35) continue;
    const y = height(r, a);
    const dr = 0.06 + rand() * 0.08;
    const da = (rand() - 0.5) * 0.05;
    const a2 = a + da;
    segment(
      silk,
      new Vector3(Math.cos(a) * r, y + 0.015, Math.sin(a) * r),
      new Vector3(Math.cos(a2) * (r + dr), height(r + dr, a2) + 0.015, Math.sin(a2) * (r + dr)),
    );
  }

  // 丘顶轮廓、外脚线、内缘。
  const loop = (
    radiusAt: (a: number) => number,
    yAt: (r: number, a: number) => number,
    step = 1,
  ): void => {
    const points: Vector3[] = [];
    for (let j = 0; j <= ANGLES; j++) {
      const a = (j / ANGLES) * TAU;
      const r = radiusAt(a);
      points.push(new Vector3(Math.cos(a) * r, yAt(r, a) + 0.012, Math.sin(a) * r));
    }
    for (let j = 0; j < points.length - 1; j += step) {
      segment(ink, points[j], points[j + 1]);
    }
  };
  loop(
    (a) => rimRadius(a),
    (r, a) => height(r, a),
  );
  loop(
    () => RO - 0.02,
    () => 0.02,
  );
  loop(
    () => RI + 0.02,
    (r, a) => height(r, a),
  );

  // 外坡的两条等高碎线，读出体积。
  for (const r of [2.42, 2.72]) {
    for (let j = 0; j < ANGLES; j += 2) {
      const a = (j / ANGLES) * TAU;
      if (door(a) > 0.3 || rand() < 0.35) continue;
      const a2 = ((j + 1.6) / ANGLES) * TAU;
      segment(
        silk,
        new Vector3(Math.cos(a) * r, height(r, a) + 0.012, Math.sin(a) * r),
        new Vector3(Math.cos(a2) * r, height(r, a2) + 0.012, Math.sin(a2) * r),
      );
    }
  }

  // 门洞两侧的切边。
  for (const side of [-1, 1]) {
    const a = DOOR + side * (DOOR_HALF + 0.16);
    const inner = RI + 0.2;
    segment(
      ink,
      new Vector3(Math.cos(a) * inner, height(inner, a) + 0.01, Math.sin(a) * inner),
      new Vector3(Math.cos(a) * (RO - 0.1), 0.03, Math.sin(a) * (RO - 0.1)),
    );
  }

  // 门外的一块踏石和几颗石子。
  const step = new Mesh(new BoxGeometry(1.4, 0.08, 0.55), paperMat);
  step.position.set(0, 0.045, -2.6);
  step.rotation.y = 0.08;
  step.add(new LineSegments(new EdgesGeometry(step.geometry, 1), inkMat));
  group.add(step);
  for (const [x, z, size] of [
    [-0.95, -2.15, 0.18],
    [1.02, -2.28, 0.14],
    [0.42, -3.0, 0.1],
  ]) {
    group.add(pebble(x, z, size, rand));
  }

  // 坑里的蛛网：辐条从圆心拉到穴壁，螺旋丝有些断口，边上有露珠。
  const hub = new Vector3(0.12, FLOOR + 0.07, 0.08);

  const spokes = 18;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * TAU + 0.13 + 0.05 * Math.sin(i * 3.7);
    const edgeR = 1.12 + 0.09 * Math.sin(i * 2.3) + 0.04 * Math.sin(i * 5.1);
    const edge = new Vector3(hub.x + Math.cos(a) * edgeR, hub.y, hub.z + Math.sin(a) * edgeR);
    segment(ink, hub.clone().add(new Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06)), edge);
    // 从网边拉上穴壁，锚点高一点，网就不是摊平的靶盘。
    const anchorR = 1.36 + 0.05 * Math.sin(i * 1.7);
    const anchorY = Math.max(hub.y + 0.06, height(anchorR, a) + 0.03);
    const anchor = new Vector3(Math.cos(a) * anchorR, anchorY, Math.sin(a) * anchorR);
    const mid = edge.clone().lerp(anchor, 0.5);
    mid.y = edge.y + (anchor.y - edge.y) * 0.55;
    segment(ink, edge, mid);
    segment(ink, mid, anchor);
  }

  // 螺旋丝：圈距忽宽忽窄，偶尔断开。
  const turns = 3.6;
  const thetaMax = turns * TAU;
  const rMax = 1.04;
  let theta = 0.7;
  let prev: Vector3 | null = null;
  while (theta < thetaMax) {
    const r =
      (0.16 + (rMax - 0.16) * (theta / thetaMax)) * (1 + 0.045 * Math.sin(theta * 2.1 + 0.6));
    const wob = 0.014 * Math.sin(theta * 7.3);
    const point = new Vector3(
      hub.x + Math.cos(theta) * (r + wob),
      hub.y + 0.006 * Math.sin(theta * 3.1) + 0.03 * (r / rMax),
      hub.z + Math.sin(theta) * (r + wob),
    );
    const gap = Math.sin(theta * 1.31 + 0.7) > 0.72;
    if (prev && !gap) segment(silk, prev, point);
    prev = point;
    theta += 0.15 + 0.04 * Math.sin(theta * 0.9);
  }

  // 露珠。
  for (let k = 0; k < 9; k++) {
    const a = 0.4 + k * 0.77;
    const r = 0.35 + ((k * 0.37) % 0.62);
    const cx = hub.x + Math.cos(a) * r;
    const cz = hub.z + Math.sin(a) * r;
    const cy = hub.y + 0.02 + 0.03 * (r / rMax);
    const size = 0.018 + (k % 3) * 0.006;
    for (let j = 0; j < 10; j++) {
      const b = (j / 10) * TAU;
      const b2 = ((j + 1) / 10) * TAU;
      segment(
        silk,
        new Vector3(cx + Math.cos(b) * size, cy, cz + Math.sin(b) * size),
        new Vector3(cx + Math.cos(b2) * size, cy, cz + Math.sin(b2) * size),
      );
    }
  }

  // 圆心的小退路。
  for (let k = 0; k < 5; k++) {
    const r = 0.05 + k * 0.026;
    for (let j = 0; j < 14; j++) {
      const a = (j / 14) * TAU;
      const b = ((j + 1) / 14) * TAU;
      segment(
        ink,
        new Vector3(hub.x + Math.cos(a) * r, hub.y, hub.z + Math.sin(a) * r),
        new Vector3(hub.x + Math.cos(b) * r, hub.y, hub.z + Math.sin(b) * r),
      );
    }
  }

  // 领口的丝线：从丘顶垂进洞里。
  for (let j = 0; j < 14; j++) {
    const a = (j / 14) * TAU + 0.11;
    if (door(a) > 0.25) continue;
    const rr = rimRadius(a);
    const top = new Vector3(Math.cos(a) * rr, height(rr, a) + 0.02, Math.sin(a) * rr);
    const mid = new Vector3(Math.cos(a) * (RI + 0.3), FLOOR + 0.42, Math.sin(a) * (RI + 0.3));
    const low = new Vector3(Math.cos(a) * (RI - 0.15), FLOOR + 0.05, Math.sin(a) * (RI - 0.15));
    segment(ink, top, mid);
    segment(ink, mid, low);
  }

  // 警戒丝：从丘顶拉到外面的草脚。
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * TAU + 0.28;
    if (door(a) > 0.2) continue;
    const rr = rimRadius(a);
    const from = new Vector3(Math.cos(a) * rr, height(rr, a) + 0.03, Math.sin(a) * rr);
    const out = 2.9 + rand() * 0.2;
    const to = new Vector3(Math.cos(a) * out, 0.03, Math.sin(a) * out);
    const mid = from.clone().lerp(to, 0.55);
    mid.y = Math.max(0.12, mid.y - 0.18);
    segment(silk, from, mid);
    segment(silk, mid, to);
    group.add(peg(to.x, to.z));
  }

  // 基部的碎石与两簇草。
  for (let k = 0; k < 9; k++) {
    const a = rand() * TAU;
    const r = 2.8 + rand() * 0.25;
    group.add(pebble(Math.cos(a) * r, Math.sin(a) * r, 0.07 + rand() * 0.08, rand));
  }
  // 巢脚围一圈草，三种草都来一点；门口留空。
  const ring = ['thin', 'seed', 'broad'] as const;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.2;
    if (Math.abs(wrap(a + Math.PI / 2)) < 0.8) continue;
    const r = 3.0 + rand() * 0.6;
    const tuft = buildGrass(0.5, 200 + i, ring[i % 3]);
    tuft.position.set(Math.cos(a) * r, 0.01, Math.sin(a) * r);
    group.add(tuft);
  }

  group.add(lineFrom(ink));
  group.add(lineFrom(silk, silkMat));
  group.scale.set(SCALE, 1.15, SCALE);
  return group;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
