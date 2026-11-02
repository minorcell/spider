import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  Vector3,
} from 'three';
import { mulberry32 } from '../shared/noise.js';
import { grassMat, inkMat } from '../shared/sim/parts.js';

// 草成堆长。旧版一片草是 64 根方条，远远看去像木栅栏；现在每片只有三四堆，
// 每堆十几片弯叶，叶子更长、更宽，顶点总数反而更少。

const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
/** 叶片根部离地的高度，drape 时按这个值反推。 */
const BASE_Y = 0.015;

export type GrassStyle = 'thin' | 'seed' | 'broad';

interface BladeRecord {
  readonly x: number;
  readonly z: number;
  readonly paperFrom: number;
  readonly paperTo: number;
  readonly inkFrom: number;
  readonly inkTo: number;
}

interface Batch {
  readonly paper: number[];
  readonly indices: number[];
  readonly ink: number[];
  readonly blades: BladeRecord[];
}

interface BladeOptions {
  readonly base: Vector3;
  readonly yaw: number;
  readonly length: number;
  readonly lean: number;
  readonly droop: number;
  readonly width: number;
  readonly twist?: number;
  readonly veins?: number;
  readonly midrib?: boolean;
}

function segment(out: number[], a: Vector3, b: Vector3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

/** 一片弯叶，返回中脉上的点，便于在叶尖接穗。 */
function addBlade(batch: Batch, options: BladeOptions): Vector3[] {
  const { base, yaw, length, lean, droop, width, twist = 0, veins = 0, midrib = false } = options;
  const dir = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const side = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const curve = new CubicBezier(
    new Vector3(0, 0, 0),
    dir
      .clone()
      .multiplyScalar(length * 0.06)
      .addScaledVector(UP, length * 0.46),
    dir
      .clone()
      .multiplyScalar(length * lean * 0.62)
      .addScaledVector(UP, length * (0.9 - droop * 0.12)),
    dir
      .clone()
      .multiplyScalar(length * lean)
      .addScaledVector(UP, length * (0.82 - droop * 0.62)),
  );
  const steps = 5;
  const paperFrom = batch.paper.length / 3;
  const inkFrom = batch.ink.length / 3;
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  const spine: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = curve.point(t);
    const tangent = curve.tangent(t);
    const taper = Math.pow(1 - t, 0.8) * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.5)));
    const half = Math.max(0.0015, width * taper);
    const cross = side.clone().applyAxisAngle(tangent, twist * t);
    left.push(point.clone().addScaledVector(cross, half).add(base));
    right.push(point.clone().addScaledVector(cross, -half).add(base));
    spine.push(point.clone().add(base));
  }
  for (let i = 0; i <= steps; i++) {
    batch.paper.push(left[i].x, left[i].y, left[i].z, right[i].x, right[i].y, right[i].z);
  }
  const start = paperFrom;
  for (let i = 0; i < steps; i++) {
    const a = start + i * 2;
    batch.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (let i = 0; i < steps; i++) {
    segment(batch.ink, left[i], left[i + 1]);
    segment(batch.ink, right[i], right[i + 1]);
    if (midrib) segment(batch.ink, spine[i], spine[i + 1]);
  }
  segment(batch.ink, left[0], right[0]);
  for (let v = 1; v <= veins; v++) {
    const i = Math.min(steps - 1, Math.round((0.3 + v * 0.15) * steps));
    segment(batch.ink, spine[i], left[Math.min(steps, i + 2)]);
    segment(batch.ink, spine[i], right[Math.min(steps, i + 2)]);
  }
  batch.blades.push({
    x: base.x,
    z: base.z,
    paperFrom,
    paperTo: batch.paper.length / 3,
    inkFrom,
    inkTo: batch.ink.length / 3,
  });
  return spine;
}

/** 三次贝塞尔，只用到点和切线。 */
class CubicBezier {
  constructor(
    readonly p0: Vector3,
    readonly p1: Vector3,
    readonly p2: Vector3,
    readonly p3: Vector3,
  ) {}

  point(t: number): Vector3 {
    const u = 1 - t;
    return new Vector3()
      .addScaledVector(this.p0, u * u * u)
      .addScaledVector(this.p1, 3 * u * u * t)
      .addScaledVector(this.p2, 3 * u * t * t)
      .addScaledVector(this.p3, t * t * t);
  }

  tangent(t: number): Vector3 {
    const u = 1 - t;
    return new Vector3()
      .addScaledVector(this.p1.clone().sub(this.p0), 3 * u * u)
      .addScaledVector(this.p2.clone().sub(this.p1), 6 * u * t)
      .addScaledVector(this.p3.clone().sub(this.p2), 3 * t * t)
      .normalize();
  }
}

/** 一根抽穗：细茎加两侧交替的小芒。 */
function addHead(
  batch: Batch,
  base: Vector3,
  yaw: number,
  scale: number,
  rand: () => number,
): void {
  const stem = addBlade(batch, {
    base,
    yaw,
    length: (0.62 + rand() * 0.3) * (0.75 + scale * 0.45),
    lean: 0.08 + rand() * 0.14,
    droop: 0.12,
    width: 0.006,
  });
  const side = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const top = stem[stem.length - 1];
  for (let k = 0; k < 7; k++) {
    const from = top.clone().addScaledVector(UP, -0.19 + k * 0.031);
    const reach = 0.03 + 0.014 * Math.sin(k * 1.3);
    segment(
      batch.ink,
      from,
      from
        .clone()
        .addScaledVector(side, (k % 2 === 0 ? 1 : -1) * reach)
        .addScaledVector(UP, 0.032),
    );
  }
  segment(batch.ink, top.clone().addScaledVector(UP, -0.2), top.clone().addScaledVector(UP, 0.02));
}

/** 一片草：三四个大小不一的草堆，叶子向上抽再弯下。 */
export function buildGrass(radius: number, seed: number, style: GrassStyle): Group {
  const rand = mulberry32(seed);
  const batch: Batch = { paper: [], indices: [], ink: [], blades: [] };
  const broad = style === 'broad';
  // 两堆就够一片草：岛上草片多，单堆要挤满叶子。
  const clumps = Math.max(1, Math.min(2, Math.round(radius * 0.8)));
  const offset = rand() * TAU;

  for (let c = 0; c < clumps; c++) {
    // 草堆沿螺旋铺开，堆与堆之间留出空地。
    const scale = 0.8 + rand() * 1.05;
    const angle = offset + c * 2.399963;
    const dist = radius * 0.9 * Math.sqrt((c + 0.6) / clumps) + (rand() - 0.5) * 0.2;
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    const spread = (broad ? 0.19 : 0.15) * (0.6 + scale * 0.6);
    const count = Math.max(10, Math.round((broad ? 10 : 12) * scale));

    for (let b = 0; b < count; b++) {
      const a = rand() * TAU;
      const d = spread * Math.sqrt(rand());
      addBlade(batch, {
        base: new Vector3(cx + Math.cos(a) * d, BASE_Y, cz + Math.sin(a) * d),
        yaw: a + (rand() - 0.5) * 1.7,
        length: (broad ? 0.46 + rand() * 0.38 : 0.42 + rand() * 0.58) * (0.8 + scale * 0.5),
        lean: 0.14 + rand() * (broad ? 0.66 : 0.48) + scale * 0.08,
        droop: rand() * (broad ? 0.85 : 0.55),
        width: broad ? 0.09 + rand() * 0.04 : 0.032 + rand() * 0.018,
        twist: (rand() - 0.5) * 1.1,
        veins: broad ? 2 : 0,
        midrib: broad,
      });
    }

    if (style === 'seed') {
      const heads = Math.max(1, Math.round(scale * 1.6));
      for (let h = 0; h < heads; h++) {
        const a = rand() * TAU;
        const d = spread * 0.6 * Math.sqrt(rand());
        addHead(
          batch,
          new Vector3(cx + Math.cos(a) * d, BASE_Y, cz + Math.sin(a) * d),
          rand() * TAU,
          scale,
          rand,
        );
      }
    }
  }

  const paper = new BufferGeometry();
  paper.setAttribute('position', new Float32BufferAttribute(batch.paper, 3));
  paper.setIndex(batch.indices);
  const ink = new BufferGeometry();
  ink.setAttribute('position', new Float32BufferAttribute(batch.ink, 3));
  const group = new Group();
  group.add(new Mesh(paper, grassMat), new LineSegments(ink, inkMat));
  group.userData.blades = batch.blades as BladeRecord[];
  return group;
}

/** 每根草按自己脚下的地面抬起，斜坡上不会一半埋进土里。 */
export function drapeGrass(
  group: Group,
  x: number,
  z: number,
  height: (x: number, z: number) => number,
): void {
  group.position.set(x, 0, z);
  const blades = group.userData.blades as BladeRecord[] | undefined;
  if (!blades) return;
  const paper = (group.children[0] as Mesh).geometry.getAttribute('position') as BufferAttribute;
  const ink = (group.children[1] as LineSegments).geometry.getAttribute(
    'position',
  ) as BufferAttribute;

  for (const blade of blades) {
    const lift = height(x + blade.x, z + blade.z) + 0.02 - BASE_Y;
    for (let i = blade.paperFrom; i < blade.paperTo; i++) {
      paper.setY(i, paper.getY(i) + lift);
    }
    for (let i = blade.inkFrom; i < blade.inkTo; i++) {
      ink.setY(i, ink.getY(i) + lift);
    }
  }
  paper.needsUpdate = true;
  ink.needsUpdate = true;
}
