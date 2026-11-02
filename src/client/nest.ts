import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { mulberry32 } from '../shared/noise.js';
import {
  growShell,
  inkMat,
  inkSolidMat,
  paperMat,
  silkMat,
  soilMat,
  stemMat,
  stoneMat,
} from '../shared/sim/parts.js';
import { buildGrass } from './grassMesh.js';

// 巢穴是一圈土丘：背后堆得高、门口压得低，中间是一个浅坑。
// 土、石和木桩用薄墨壳勾边，丝和抓痕走曲线，跟蜘蛛的形体线同一套。
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

/** 二次曲线，步数够了就读成一根弯丝，而不是一条直尺。 */
function bend(out: number[], a: Vector3, b: Vector3, control: Vector3, steps = 6): void {
  let prev = a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const p = new Vector3(
      u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      u * u * a.y + 2 * u * t * control.y + t * t * b.y,
      u * u * a.z + 2 * u * t * control.z + t * t * b.z,
    );
    segment(out, prev, p);
    prev = p;
  }
}

function lineFrom(flat: readonly number[], material: Material = inkMat): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flat, 3));
  return new LineSegments(geometry, material);
}

/** 一颗圆石：压扁的球，薄墨壳勾边。 */
function pebble(x: number, z: number, size: number, rand: () => number): Mesh {
  const geometry = new SphereGeometry(1, 12, 8);
  geometry.scale(0.85 + rand() * 0.3, 0.55 + rand() * 0.15, 0.8 + rand() * 0.25);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, stoneMat);
  mesh.name = 'pebble';
  mesh.scale.setScalar(size);
  mesh.position.set(x, size * 0.28, z);
  mesh.rotation.set(rand() * 0.4, rand() * TAU, rand() * 0.3);
  mesh.add(new Mesh(growShell(geometry, 0.08), inkSolidMat));
  return mesh;
}

/** 一根拴丝的小木桩，收成细圆杆。 */
function peg(x: number, z: number): Mesh {
  const geometry = new CylinderGeometry(0.008, 0.016, 0.16, 8);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, stemMat);
  mesh.position.set(x, 0.06, z);
  mesh.add(new Mesh(growShell(geometry, 0.003), inkSolidMat));
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
    const dr = 0.08 + rand() * 0.1;
    const da = (rand() - 0.5) * 0.12;
    const a2 = a + da;
    const start = new Vector3(Math.cos(a) * r, y + 0.015, Math.sin(a) * r);
    const end = new Vector3(
      Math.cos(a2) * (r + dr),
      height(r + dr, a2) + 0.015,
      Math.sin(a2) * (r + dr),
    );
    const control = start.clone().lerp(end, 0.5);
    control.y += 0.025;
    control.add(new Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar((rand() - 0.5) * 0.06));
    bend(silk, start, end, control, 4);
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

  // 外坡上两道完整的形体线，顺着丘面走。
  loop(
    (a) => rimRadius(a) * 0.78,
    (r, a) => height(r, a),
  );
  loop(
    (a) => rimRadius(a) * 0.58,
    (r, a) => height(r, a),
  );

  // 门洞两侧沿坡面弯下来。
  for (const side of [-1, 1]) {
    const a = DOOR + side * (DOOR_HALF + 0.16);
    let prev: Vector3 | null = null;
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      const r = RI + 0.2 + (RO - 0.1 - (RI + 0.2)) * t;
      const aa = a + side * 0.1 * Math.sin(Math.PI * t);
      const point = new Vector3(Math.cos(aa) * r, height(r, aa) + 0.01, Math.sin(aa) * r);
      if (prev) segment(ink, prev, point);
      prev = point;
    }
  }

  // 门口只留几颗石子，不放石板。
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
    const start = hub.clone().add(new Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06));
    const spoke = start.clone().lerp(edge, 0.5);
    spoke.y += 0.015;
    spoke.add(new Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.045 * Math.sin(i)));
    bend(ink, start, edge, spoke, 5);
    // 从网边拉上穴壁，中间下垂，网就不是摊平的靶盘。
    const anchorR = 1.36 + 0.05 * Math.sin(i * 1.7);
    const anchorY = Math.max(hub.y + 0.06, height(anchorR, a) + 0.03);
    const anchor = new Vector3(Math.cos(a) * anchorR, anchorY, Math.sin(a) * anchorR);
    const sag = edge.clone().lerp(anchor, 0.5);
    sag.y = edge.y + (anchor.y - edge.y) * 0.32;
    bend(ink, edge, anchor, sag, 5);
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
    const drop = new SphereGeometry(size, 8, 6);
    drop.computeVertexNormals();
    const bead = new Mesh(drop, paperMat);
    bead.position.set(cx, cy, cz);
    bead.add(new Mesh(growShell(drop, size * 0.35), inkSolidMat));
    group.add(bead);
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
    const low = new Vector3(Math.cos(a) * (RI - 0.15), FLOOR + 0.05, Math.sin(a) * (RI - 0.15));
    const sag = new Vector3(Math.cos(a) * (RI + 0.45), FLOOR + 0.18, Math.sin(a) * (RI + 0.45));
    bend(ink, top, low, sag, 8);
  }

  // 警戒丝：从丘顶拉到外面的草脚。
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * TAU + 0.28;
    if (door(a) > 0.2) continue;
    const rr = rimRadius(a);
    const from = new Vector3(Math.cos(a) * rr, height(rr, a) + 0.03, Math.sin(a) * rr);
    const out = 2.9 + rand() * 0.2;
    const to = new Vector3(Math.cos(a) * out, 0.03, Math.sin(a) * out);
    const sag = from.clone().lerp(to, 0.55);
    sag.y = Math.max(0.08, Math.min(from.y, sag.y) - 0.22);
    bend(silk, from, to, sag, 7);
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
