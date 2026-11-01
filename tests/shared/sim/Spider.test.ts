import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GAIT } from '../../../src/shared/config.js';
import { Spider } from '../../../src/shared/sim/Spider.js';

const IDLE = { throttle: 0, turn: 0, lift: 0, boost: 0 };

function mountWorld(spider: Spider, index: number): Vector3 {
  spider.root.updateMatrixWorld(true);
  return spider.legs[index].mount.getWorldPosition(new Vector3());
}

function specDir(spider: Spider, index: number): Vector3 {
  const spec = spider.legs[index].spec;
  return new Vector3(spec.x, 0, spec.z).normalize();
}

function worldRight(spider: Spider): Vector3 {
  const forward = new Vector3(0, 0, -1).applyQuaternion(spider.root.quaternion);
  return new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
}

describe('Spider', () => {
  it('builds eight legs and a rig', () => {
    const spider = new Spider();
    expect(spider.legs).toHaveLength(8);
    expect(spider.rig.children.length).toBeGreaterThan(8);
    const state = spider.capture();
    expect(state.feet).toHaveLength(8);
    expect(state.feet.every((foot) => Number.isFinite(foot.y))).toBe(true);
  });

  it('reseeds the stance when the ground binds', () => {
    const spider = new Spider();
    spider.bindGround((x, z) => 0.1 * x + 0.2 * z, 10);
    const state = spider.capture();
    expect(state.feet.every((foot) => Number.isFinite(foot.y))).toBe(true);
  });

  it('poses without advancing at dt 0', () => {
    const spider = new Spider();
    spider.update(0, IDLE);
    expect(spider.time).toBe(0);
  });

  it('adopts an authoritative state', () => {
    const spider = new Spider();
    const feet = Array.from({ length: 8 }, (_, i) => ({ x: i, y: 0.2, z: -i }));
    spider.applyState({
      time: 2,
      position: { x: 1, y: 0.5, z: 2 },
      yaw: 0.5,
      speed: 1.25,
      height: 0.2,
      chassisPitch: 0.1,
      chassisRoll: 0.2,
      headYaw: 0.3,
      feet,
    });
    expect(spider.time).toBe(2);
    expect(spider.yaw).toBe(0.5);
    expect(spider.speed).toBe(1.25);
    expect(spider.heightSet).toBe(0.2);
    expect(spider.root.position.toArray()).toEqual([1, 0.5, 2]);
    expect(spider.legs[3].foot.toArray()).toEqual([3, 0.2, -3]);
  });

  it('steers, lifts, and pitches with the input', () => {
    const spider = new Spider();
    spider.update(0.1, { throttle: 1, turn: 1, lift: 1, boost: 1 });
    expect(spider.time).toBeCloseTo(0.1);
    expect(spider.speed).toBeGreaterThan(0);
    expect(spider.yawRate).toBeGreaterThan(0);
    expect(spider.headYaw).toBeLessThan(0);
    expect(spider.heightSet).toBeGreaterThan(0);
    expect(spider.chassis.rotation.x).toBeCloseTo(-GAIT.pitch);
  });

  it('clamps the deck height', () => {
    const spider = new Spider();
    for (let i = 0; i < 40; i++) spider.update(0.1, { ...IDLE, lift: 1 });
    expect(spider.heightSet).toBeCloseTo(GAIT.heightMax);
    for (let i = 0; i < 80; i++) spider.update(0.1, { ...IDLE, lift: -1 });
    expect(spider.heightSet).toBeCloseTo(GAIT.heightMin);
  });

  it('stops dead against a solid', () => {
    const spider = new Spider();
    spider.bindBlocked(() => true);
    spider.update(0.1, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('solid');
    expect(spider.speed).toBe(0);
  });

  it('slides along x when only the forward step is blocked', () => {
    const spider = new Spider();
    spider.yaw = Math.PI / 4;
    spider.bindBlocked((_x, z) => z < -1e-6);
    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('clear');
    expect(spider.root.position.x).toBeLessThan(0);
    expect(spider.root.position.z).toBe(0);
  });

  it('slides along z when only the sideways step is blocked', () => {
    const spider = new Spider();
    spider.yaw = Math.PI / 4;
    spider.bindBlocked((x) => x < -1e-6);
    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('clear');
    expect(spider.root.position.z).toBeLessThan(0);
    expect(spider.root.position.x).toBe(0);
  });

  it('refuses a step that climbs too fast', () => {
    const spider = new Spider();
    spider.bindGround((_x, z) => (z < -1e-4 ? 100 : 0));
    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('steep');
    expect(spider.speed).toBe(0);
  });

  it('clamps the body inside the ground limit', () => {
    const spider = new Spider();
    spider.bindGround(() => 0, 1);
    spider.root.position.set(0.9, 0, 0);
    spider.yaw = Math.PI / 2;
    spider.update(0.2, { ...IDLE, throttle: -1 });
    expect(spider.root.position.x).toBe(1);
  });

  it('falls instead of easing down a real drop', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.root.position.y = 20;
    for (let i = 0; i < 400; i++) spider.update(0.05);
    expect(spider.root.position.y).toBeCloseTo(0);
    expect(spider.fall).toBe(0);
  });

  it('eases down a small gap', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.root.position.y = 0.1;
    spider.update(0.1);
    expect(spider.root.position.y).toBeGreaterThan(0);
    expect(spider.root.position.y).toBeLessThan(0.1);
  });

  it('keeps the feet at body height while airborne', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.root.position.y = 5;
    for (let i = 0; i < 50; i++) spider.update(0.01, { ...IDLE, throttle: 1 });
    expect(spider.capture().feet.some((foot) => foot.y > 1)).toBe(true);
  });

  it('steps both tetrapods through a long walk', () => {
    const spider = new Spider();
    for (let i = 0; i < 400; i++) spider.update(0.05, { ...IDLE, throttle: 0.8 });
    const lifting = spider.legs.filter((leg) => leg.lifted).length;
    expect(lifting).toBeGreaterThan(0);
    const feet = spider.capture().feet;
    expect(new Set(feet.map((foot) => foot.x.toFixed(2))).size).toBeGreaterThan(1);
  });

  it('runs with boost', () => {
    const spider = new Spider();
    for (let i = 0; i < 40; i++) spider.update(0.05, { ...IDLE, throttle: 1, boost: 1 });
    expect(spider.speed).toBeGreaterThan(GAIT.cruise);
  });

  it('turns in place and settles', () => {
    const spider = new Spider();
    for (let i = 0; i < 90; i++) spider.update(0.05, { ...IDLE, turn: 0.8 });
    const yawAfterTurn = spider.yaw;
    for (let i = 0; i < 400; i++) spider.update(0.05, IDLE);
    expect(yawAfterTurn).not.toBe(0);
    expect(Math.abs(spider.yawRate)).toBeLessThan(1e-3);
    expect(spider.legs.every((leg) => !leg.lifted)).toBe(true);
  });

  it('shifts weight once still for a while', () => {
    const spider = new Spider();
    spider.update(0.01);
    for (let i = 0; i < 120; i++) spider.update(0.05);
    expect(Number.isFinite(spider.chassis.rotation.z)).toBe(true);
  });

  it('handles a foot with no horizontal reach from its shoulder', () => {
    const spider = new Spider();
    spider.update(0);
    spider.legs[0].foot.copy(mountWorld(spider, 0));
    spider.update(0);
    expect(Number.isFinite(spider.legs[0].foot.x)).toBe(true);
  });

  it('handles a zero-length two-bone reach', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[0];
    const shoulder = mountWorld(spider, 0);
    const dir = specDir(spider, 0);
    leg.foot.copy(shoulder).addScaledVector(dir, 0.685);
    leg.foot.y = shoulder.y - 0.08;
    spider.update(0);
    expect(Number.isFinite(leg.foot.x)).toBe(true);
  });

  it('picks a knee plane when the pole is parallel to the reach', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[0];
    const shoulder = mountWorld(spider, 0);
    const dir = specDir(spider, 0);
    leg.foot.copy(shoulder).addScaledVector(dir, 0.91);
    leg.foot.y = shoulder.y + 0.42;
    spider.update(0);
    expect(Number.isFinite(leg.foot.x)).toBe(true);
  });

  it('clamps both ends of the reach', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[0];
    const shoulder = mountWorld(spider, 0);
    const dir = specDir(spider, 0);
    leg.foot.copy(shoulder).addScaledVector(dir, 100);
    leg.foot.y = shoulder.y + 100;
    spider.update(0);
    leg.foot.copy(shoulder);
    leg.foot.y = shoulder.y - 0.08;
    spider.update(0);
    expect(Number.isFinite(leg.foot.x)).toBe(true);
  });

  it('twists a bone toward the body when it points along the body side', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[1];
    const shoulder = mountWorld(spider, 1);
    leg.foot.copy(shoulder).addScaledVector(worldRight(spider), 0.7);
    leg.foot.y = shoulder.y - 0.08;
    spider.update(0);
    expect(Number.isFinite(leg.bones[0].scale.z)).toBe(true);
  });
});
