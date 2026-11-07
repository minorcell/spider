import { Vector3 } from 'three';
import { BONES } from '../config.js';

export interface LegSphere {
  x: number;
  y: number;
  z: number;
  radius: number;
}

const RELAX_STEPS = 4;
const SAMPLE_T = [0.35, 0.7];

const dir = new Vector3();
const pole = new Vector3();
const coxa = new Vector3();
const ankle = new Vector3();
const knee = new Vector3();
const end = new Vector3();
const reach = new Vector3();
const axis = new Vector3();
const sample = new Vector3();
const push = new Vector3();
const delta = new Vector3();
const aim = new Vector3();

export function supportY(
  x: number,
  z: number,
  ground: (x: number, z: number) => number,
  mound: (x: number, z: number) => number,
  spheres: readonly LegSphere[],
): number {
  let y = ground(x, z);
  const moundY = mound(x, z);
  if (moundY > y) y = moundY;
  for (const sphere of spheres) {
    const dx = x - sphere.x;
    const dz = z - sphere.z;
    const squared = dx * dx + dz * dz;
    if (squared >= sphere.radius * sphere.radius) continue;
    const top = sphere.y + Math.sqrt(sphere.radius * sphere.radius - squared);
    if (top > y) y = top;
  }
  return y;
}

export function solveLeg(
  shoulder: Vector3,
  foot: Vector3,
  hintX: number,
  hintZ: number,
  ground: (x: number, z: number) => number,
  mound: (x: number, z: number) => number,
  spheres: readonly LegSphere[],
  out: Vector3[],
): void {
  aim.copy(foot);
  const floor = supportY(foot.x, foot.z, ground, mound, spheres);
  if (floor > aim.y) aim.y = floor;
  writeLegacy(shoulder, aim, hintX, hintZ, out);
  relax(out, ground, mound, spheres);
}

function writeLegacy(
  shoulder: Vector3,
  foot: Vector3,
  hintX: number,
  hintZ: number,
  out: Vector3[],
): void {
  dir.subVectors(foot, shoulder);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(hintX, 0, hintZ);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();

  coxa.copy(shoulder).addScaledVector(dir, BONES[0].len);
  ankle.copy(foot).addScaledVector(dir, -BONES[3].len * 0.75);
  ankle.y = foot.y + 0.08;
  end.copy(foot);

  reach.subVectors(ankle, coxa);
  const span = reach.length();
  const limit = BONES[1].len + BONES[2].len - 0.04;
  if (span > limit) {
    ankle.copy(coxa).addScaledVector(reach, limit / span);
    end.copy(ankle).addScaledVector(dir, BONES[3].len * 0.75);
    end.y = ankle.y - 0.08;
  }

  pole.set(0, 1, 0).addScaledVector(dir, 0.45);
  bendJoint(coxa, ankle, BONES[1].len, BONES[2].len, pole, knee);
  out[0].copy(shoulder);
  out[1].copy(coxa);
  out[2].copy(knee);
  out[3].copy(ankle);
  out[4].copy(end);
}

function relax(
  points: Vector3[],
  ground: (x: number, z: number) => number,
  mound: (x: number, z: number) => number,
  spheres: readonly LegSphere[],
): void {
  for (let step = 0; step < RELAX_STEPS; step++) {
    let moved = false;
    for (let bone = 0; bone < 4; bone++) {
      const radius = BONES[bone].radius;
      for (const t of SAMPLE_T) {
        sample.lerpVectors(points[bone], points[bone + 1], t);
        if (!shove(sample, radius, ground, mound, spheres, push)) continue;
        moved = true;
        if (bone === 0) points[1].add(push);
        else {
          points[bone].addScaledVector(push, 1 - t);
          points[bone + 1].addScaledVector(push, t);
        }
      }
    }
    clampChain(points);
    if (!moved) break;
  }
  clampChain(points);
}

function clampChain(points: Vector3[]): void {
  for (let bone = 0; bone < 4; bone++) {
    delta.subVectors(points[bone + 1], points[bone]);
    const dist = delta.length();
    const max = BONES[bone].len;
    if (dist > max) points[bone + 1].copy(points[bone]).addScaledVector(delta, max / dist);
  }
}

function shove(
  at: Vector3,
  radius: number,
  ground: (x: number, z: number) => number,
  mound: (x: number, z: number) => number,
  spheres: readonly LegSphere[],
  out: Vector3,
): boolean {
  out.set(0, 0, 0);
  const floor = Math.max(ground(at.x, at.z), mound(at.x, at.z));
  const lift = floor + radius - at.y;
  if (lift > 1e-4) out.y += lift;
  for (const sphere of spheres) {
    const dx = at.x - sphere.x;
    const dy = at.y - sphere.y;
    const dz = at.z - sphere.z;
    const min = sphere.radius + radius;
    const squared = dx * dx + dy * dy + dz * dz;
    if (squared >= min * min) continue;
    const dist = Math.sqrt(squared);
    if (dist < 1e-6) {
      out.y += min;
      continue;
    }
    const scale = (min - dist) / dist;
    out.x += dx * scale;
    out.y += dy * scale;
    out.z += dz * scale;
  }
  return out.lengthSq() > 0;
}

function bendJoint(
  a: Vector3,
  b: Vector3,
  len1: number,
  len2: number,
  bend: Vector3,
  out: Vector3,
): void {
  reach.subVectors(b, a);
  const raw = reach.length();
  const dist = Math.min(Math.max(raw, Math.abs(len1 - len2) + 0.04), len1 + len2 - 0.04);
  if (raw > 1e-5) reach.multiplyScalar(1 / raw);
  else reach.set(0, 0, -1);
  const cosA = Math.min(
    Math.max((len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), -1),
    1,
  );
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  axis.copy(bend).addScaledVector(reach, -bend.dot(reach));
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  out
    .copy(a)
    .addScaledVector(reach, cosA * len1)
    .addScaledVector(axis, sinA * len1);
}
