import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LineSegments,
  Mesh,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three';
import {
  appleMat,
  growShell,
  inkMat,
  inkSolidMat,
  leafMat,
  paperMat,
  stemMat,
} from '../shared/sim/parts.js';

// 和蜘蛛一样：车出来的果身，薄墨壳勾轮廓，果面、梗和叶子走曲线，不画直棱。

/** 苹果的剖面：从果底的萼洼，绕到果顶的梗洼。x 是半径，y 是高度。 */
function appleProfile(): Vector2[] {
  const raw: readonly (readonly [number, number])[] = [
    [0.012, 0.035],
    [0.07, 0.012],
    [0.15, 0.018],
    [0.23, 0.055],
    [0.3, 0.12],
    [0.335, 0.2],
    [0.35, 0.3],
    [0.35, 0.4],
    [0.335, 0.49],
    [0.3, 0.56],
    [0.252, 0.618],
    [0.196, 0.66],
    [0.15, 0.682],
    [0.1, 0.682],
    [0.055, 0.652],
    [0.018, 0.638],
  ];
  return raw.map(([x, y]) => new Vector2(x, y));
}

function appleGeometry(): LatheGeometry {
  const geometry = new LatheGeometry(appleProfile(), 44);
  // 轻微的五瓣起伏，别让它是一个完美的旋转体。
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const a = Math.atan2(z, x);
    const lobe = 1 + 0.018 * Math.cos(5 * a + 0.7) + 0.012 * Math.cos(2 * a - 1.1);
    position.setX(i, x * lobe);
    position.setZ(i, z * lobe * 0.96);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** 沿法线把壳吹大一点，用背面黑壳当外轮廓。 */
function outlineShell(geometry: LatheGeometry, thickness: number): Mesh {
  const shell = geometry.clone();
  const position = shell.getAttribute('position');
  const normal = shell.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    position.setX(i, position.getX(i) + normal.getX(i) * thickness);
    position.setY(i, position.getY(i) + normal.getY(i) * thickness);
    position.setZ(i, position.getZ(i) + normal.getZ(i) * thickness);
  }
  return new Mesh(shell, inkSolidMat);
}

/** 浮点坐标转一组墨线。 */
function lineFrom(flat: readonly number[]): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flat, 3));
  return new LineSegments(geometry, inkMat);
}

function quad(
  out: number[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  scale: number,
): void {
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const p = at(t0);
    const q = at(t1);
    out.push(p[0] * scale, p[1] * scale, 0.001, q[0] * scale, q[1] * scale, 0.001);
  }
  function at(t: number): [number, number] {
    const u = 1 - t;
    return [u * u * ax + 2 * u * t * bx + t * t * cx, u * u * ay + 2 * u * t * by + t * t * cy];
  }
}

function cubic(
  out: number[],
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  scale: number,
): void {
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const a = at(i / steps);
    const b = at((i + 1) / steps);
    out.push(a[0] * scale, a[1] * scale, 0.001, b[0] * scale, b[1] * scale, 0.001);
  }
  function at(t: number): [number, number] {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  }
}

function appleLeaf(scale: number): Mesh {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.05, 0.06, 0.16, 0.07, 0.24, 0.01);
  shape.bezierCurveTo(0.16, -0.05, 0.05, -0.045, 0, 0);
  const geometry = new ShapeGeometry(shape);
  geometry.scale(scale, scale, scale);
  const mesh = new Mesh(geometry, leafMat);
  const ink: number[] = [];
  cubic(ink, [0, 0], [0.05, 0.06], [0.16, 0.07], [0.24, 0.01], scale);
  cubic(ink, [0.24, 0.01], [0.16, -0.05], [0.05, -0.045], [0, 0], scale);
  quad(ink, 0.01, 0, 0.1, 0.02, 0.22, 0.008, scale);
  quad(ink, 0.06, 0.004, 0.12, 0.045, 0.18, 0.02, scale);
  quad(ink, 0.06, 0.004, 0.12, -0.03, 0.18, -0.012, scale);
  mesh.add(lineFrom(ink));
  return mesh;
}

/** A bent stem: rings along a curve, the same language as a leg. */
function curvedStem(): Mesh {
  const spine = [
    new Vector3(0, 0, 0),
    new Vector3(0.03, 0.045, 0.012),
    new Vector3(0.075, 0.08, 0.02),
    new Vector3(0.05, 0.14, 0.004),
  ];
  const radial = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  const up = new Vector3();
  const side = new Vector3();
  const bin = new Vector3();
  const tangent = new Vector3();
  for (let i = 0; i < spine.length; i++) {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    tangent.subVectors(next, prev).normalize();
    up.set(Math.abs(tangent.y) > 0.9 ? 1 : 0, Math.abs(tangent.y) > 0.9 ? 0 : 1, 0);
    side.crossVectors(tangent, up).normalize();
    bin.crossVectors(side, tangent).normalize();
    const radius = 0.02 - i * 0.003;
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const p = spine[i]
        .clone()
        .addScaledVector(side, Math.cos(a) * radius)
        .addScaledVector(bin, Math.sin(a) * radius);
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < spine.length - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const k2 = (k + 1) % radial;
      const a = i * radial + k;
      const b = i * radial + k2;
      const c = (i + 1) * radial + k;
      const d = (i + 1) * radial + k2;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, stemMat);
  mesh.name = 'stem';
  mesh.add(new Mesh(growShell(geometry, 0.003), inkSolidMat));
  const crest: number[] = [];
  for (let i = 0; i < spine.length - 1; i++) {
    crest.push(
      spine[i].x,
      spine[i].y + 0.018 - i * 0.002,
      spine[i].z,
      spine[i + 1].x,
      spine[i + 1].y + 0.016 - i * 0.002,
      spine[i + 1].z,
    );
  }
  mesh.add(lineFrom(crest));
  return mesh;
}

/** 按高度取剖面半径，给果面的短纹定位。 */
function radiusAtY(y: number): number {
  let best = 0.1;
  for (const point of appleProfile()) {
    if (Math.abs(point.y - y) < 0.035) best = Math.max(best, point.x);
  }
  return best * 0.995;
}

/** 一只苹果，`stage` 越大咬口越深。 */
export function buildApple(stage: number): Group {
  const group = new Group();
  const geometry = appleGeometry();
  const amount = stage <= 0 ? 0 : stage === 1 ? 0.42 : 0.8;
  const cutLines: number[] = [];

  if (amount > 0) {
    const position = geometry.getAttribute('position');
    let peak = 0;
    for (let i = 0; i < position.count; i++) peak = Math.max(peak, position.getX(i));
    const cut = peak * (1 - amount);
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) > cut) position.setX(i, cut);
    }
    geometry.computeVertexNormals();

    const cutPoints: Vector3[] = [];
    for (const point of appleProfile()) {
      if (point.x <= cut) continue;
      cutPoints.push(new Vector3(cut, point.y, Math.sqrt(point.x * point.x - cut * cut)));
    }
    for (let i = 0; i < cutPoints.length - 1; i++) {
      const a = cutPoints[i];
      const b = cutPoints[i + 1];
      cutLines.push(a.x, a.y, a.z, b.x, b.y, b.z);
      cutLines.push(a.x, a.y, -a.z, b.x, b.y, -b.z);
    }
    const first = cutPoints[0];
    const last = cutPoints[cutPoints.length - 1];
    cutLines.push(first.x, first.y, first.z, first.x, first.y, -first.z);
    cutLines.push(last.x, last.y, last.z, last.x, last.y, -last.z);

    // 果肉上的两粒种子。
    for (const [dy, dz] of [
      [0.03, 0.05],
      [-0.02, -0.05],
    ]) {
      const seed = new Shape();
      seed.moveTo(0, -0.026);
      seed.bezierCurveTo(0.018, -0.01, 0.016, 0.018, 0, 0.026);
      seed.bezierCurveTo(-0.016, 0.018, -0.018, -0.01, 0, -0.026);
      const shape = new ShapeGeometry(seed);
      shape.rotateY(Math.PI / 2);
      const mesh = new Mesh(shape, paperMat);
      mesh.position.set(cut + 0.002, 0.33 + dy, dz);
      const outline: number[] = [];
      cubic(outline, [0, -0.026], [0.018, -0.01], [0.016, 0.018], [0, 0.026], 1);
      cubic(outline, [0, 0.026], [-0.016, 0.018], [-0.018, -0.01], [0, -0.026], 1);
      const ink = lineFrom(outline);
      ink.rotation.y = Math.PI / 2;
      mesh.add(ink);
      group.add(mesh);
    }
    for (let k = 0; k < 4; k++) {
      const y = 0.22 + k * 0.07;
      const z = 0.02 * Math.sin(k * 1.7);
      for (let s = 0; s < 4; s++) {
        const t0 = s / 4;
        const t1 = (s + 1) / 4;
        cutLines.push(
          cut + 0.003,
          y + Math.sin(Math.PI * t0) * 0.018,
          z - 0.05 + t0 * 0.1,
          cut + 0.003,
          y + Math.sin(Math.PI * t1) * 0.018,
          z - 0.05 + t1 * 0.1,
        );
      }
    }
    group.add(lineFrom(cutLines));
  }

  const apple = new Mesh(geometry, appleMat);
  apple.add(outlineShell(geometry, 0.008));
  group.add(apple);

  // 果面上的曲线顺着果身走，不画直经线。
  const face: number[] = [];
  const curveLine = (phi: number, y0: number, y1: number, bulge: number): void => {
    const points: Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const y = y0 + (y1 - y0) * t;
      const r = radiusAtY(y) * (1 + bulge * Math.sin(Math.PI * t));
      points.push(new Vector3(Math.cos(phi) * r - 0.004, y, Math.sin(phi) * r + 0.002));
    }
    for (let i = 0; i < points.length - 1; i++) {
      face.push(
        points[i].x,
        points[i].y,
        points[i].z,
        points[i + 1].x,
        points[i + 1].y,
        points[i + 1].z,
      );
    }
  };
  const ring = (y: number, from: number, span: number): void => {
    const r = radiusAtY(y);
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const a0 = from + (span * i) / steps;
      const a1 = from + (span * (i + 1)) / steps;
      face.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
    }
  };
  if (stage <= 0) {
    curveLine(0.5, 0.16, 0.55, 0.012);
    curveLine(-0.7, 0.14, 0.5, 0.01);
    curveLine(2.2, 0.22, 0.58, 0.008);
    curveLine(3.4, 0.18, 0.46, 0.008);
    ring(0.58, -0.4, 1.4);
    ring(0.16, 0.8, 1.2);
  } else {
    curveLine(Math.PI - 0.6, 0.16, 0.52, 0.01);
    curveLine(Math.PI + 0.5, 0.2, 0.55, 0.01);
    curveLine(Math.PI + 1.6, 0.18, 0.48, 0.008);
    ring(0.16, Math.PI - 0.4, 1.3);
  }
  group.add(lineFrom(face));

  const stem = curvedStem();
  stem.position.set(0.01, 0.66, 0);
  group.add(stem);

  const leaf = appleLeaf(0.85);
  leaf.position.set(0.055, 0.755, 0.005);
  leaf.rotation.z = -0.55;
  leaf.rotation.y = -0.5;
  leaf.rotation.x = -0.2;
  group.add(leaf);

  return group;
}
