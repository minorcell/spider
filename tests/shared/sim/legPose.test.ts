// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BONES } from '../../../src/shared/config.js';
import { solveLeg, supportY, type LegSphere } from '../../../src/shared/sim/legPose.js';

const flat = (): number => 0;
const none = (): number => Number.NEGATIVE_INFINITY;
const chain = [0, 1, 2, 3, 4].map(() => new Vector3());

function lengths(): number[] {
  return [0, 1, 2, 3].map((index) => chain[index].distanceTo(chain[index + 1]));
}

describe('solveLeg', () => {
  it('keeps the planted foot and never outgrows a bone', () => {
    const shoulder = new Vector3(0, 0.8, 0);
    const foot = new Vector3(0.9, 0.16, -0.6);
    solveLeg(shoulder, foot, -0.2, -0.4, flat, none, [], chain);
    expect(chain[4].distanceTo(foot)).toBeLessThan(1e-4);
    lengths().forEach((length, index) => {
      expect(length).toBeLessThanOrEqual(BONES[index].len + 1e-4);
    });
  });

  it('pulls an unreachable foot back instead of stretching a bone', () => {
    const shoulder = new Vector3(0, 2.4, 0);
    const foot = new Vector3(3, 0, 2);
    solveLeg(shoulder, foot, 1, 0, flat, none, [], chain);
    expect(chain[4].distanceTo(shoulder)).toBeLessThan(foot.distanceTo(shoulder));
    lengths().forEach((length, index) => {
      expect(length).toBeLessThanOrEqual(BONES[index].len + 1e-4);
    });
  });

  it('poses a foot directly under the shoulder', () => {
    const shoulder = new Vector3(0, 1, 0);
    solveLeg(shoulder, shoulder.clone().setY(0), 0, 0, flat, none, [], chain);
    lengths().forEach((length, index) => {
      expect(length).toBeLessThanOrEqual(BONES[index].len + 1e-4);
    });
    expect(Number.isFinite(chain[2].y)).toBe(true);
  });

  it('lifts a leg over a ridge and out of an apple', () => {
    const shoulder = new Vector3(0, 0.9, 0);
    const foot = new Vector3(1.3, 0.16, 0);
    const ground = (x: number): number => (x > 0.45 && x < 0.85 ? 0.55 : 0);
    const apple: LegSphere = { x: 0.7, y: 0.45, z: 0, radius: 0.28 };
    solveLeg(shoulder, foot, 1, 0, ground, none, [apple], chain);
    lengths().forEach((length, index) => {
      expect(length).toBeLessThanOrEqual(BONES[index].len + 1e-4);
    });
    for (let bone = 0; bone < 4; bone++) {
      for (const t of [0.35, 0.7]) {
        const at = chain[bone].clone().lerp(chain[bone + 1], t);
        expect(at.y).toBeGreaterThanOrEqual(ground(at.x) + BONES[bone].radius - 0.03);
        const dist = at.distanceTo(new Vector3(apple.x, apple.y, apple.z));
        expect(dist).toBeGreaterThanOrEqual(apple.radius + BONES[bone].radius - 0.03);
      }
    }
  });

  it('pushes a sample that lands on a sphere center, and stands on a mound', () => {
    const shoulder = new Vector3(0, 1, 0);
    const foot = new Vector3(1.1, 0.2, 0);
    solveLeg(shoulder, foot, 1, 0, flat, none, [], chain);
    const onCoxa = chain[0].clone().lerp(chain[1], 0.35);
    const center: LegSphere = { x: onCoxa.x, y: onCoxa.y, z: onCoxa.z, radius: 0.2 };
    solveLeg(shoulder, foot, 1, 0, flat, none, [center], chain);
    const again = chain[0].clone().lerp(chain[1], 0.35);
    expect(again.distanceTo(onCoxa)).toBeGreaterThan(0.05);

    const mound = (x: number, z: number): number => (Math.hypot(x, z) < 2 ? 0.4 : 0);
    expect(supportY(0, 0, flat, mound, [])).toBeCloseTo(0.4);
    const top = supportY(0.1, 0, flat, none, [{ x: 0, y: 0.5, z: 0, radius: 0.36 }]);
    expect(top).toBeGreaterThan(0.5);
    expect(supportY(2, 0, flat, none, [{ x: 0, y: 0.5, z: 0, radius: 0.36 }])).toBe(0);
    expect(supportY(0, 0, () => 2, none, [{ x: 0, y: 0, z: 0, radius: 0.2 }])).toBe(2);

    solveLeg(shoulder, foot, 1, 0, flat, () => 0.5, [], chain);
    const low = chain[3].y < 0.5 || chain[4].y < 0.5;
    expect(low).toBe(false);
  });
});
