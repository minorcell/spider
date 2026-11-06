import { beforeEach, describe, expect, it } from 'vitest';
import { tickWater } from '../../src/client/groundView.js';
import {
  waterContact,
  waterPush,
  waterSplashes,
  waterWakes,
  type WaterContact,
  type WaterWalker,
} from '../../src/client/waterMotion.js';
import { TERRAIN } from '../../src/shared/terrain.js';

const wet = { terrain: { height: () => TERRAIN.water - 0.4 } };
const dry = { terrain: { height: () => 1 } };

function walker(over: Partial<WaterWalker> = {}): WaterWalker {
  return {
    root: { position: { x: 1, z: 2 } },
    yaw: 0,
    speed: 0,
    waterDepth: 0,
    legs: [{ foot: { x: 3, z: 4 }, lifted: false }],
    ...over,
  };
}

let now = 10;

function advance(steps: number, contact?: WaterContact): void {
  for (let i = 0; i < steps; i++) {
    now += 0.05;
    tickWater(now, contact);
  }
}

function visibleDrops(): number {
  let count = 0;
  for (const child of waterSplashes.children) {
    if (child.name === 'water-drop' && child.visible) count += 1;
  }
  return count;
}

function visibleRings(): number {
  let count = 0;
  for (const child of waterSplashes.children) {
    if (child.name === 'water-ring' && child.visible) count += 1;
  }
  return count;
}

beforeEach(() => {
  advance(40);
});

describe('water contact', () => {
  it('ignores feet when the world is missing', () => {
    const contact = waterContact(walker({ waterDepth: 1, speed: 2 }), [true], null);
    expect(contact.depth).toBe(0);
    expect(contact.strikes).toHaveLength(0);
    expect(contact.dirZ).toBeCloseTo(-1);
  });

  it('records a foot that plants in the water', () => {
    const contact = waterContact(walker({ speed: 1, waterDepth: 0.2 }), [true], wet);
    expect(contact.strikes).toHaveLength(1);
    expect(contact.strikes[0].x).toBe(3);
    expect(contact.strikes[0].power).toBeGreaterThan(0.8);
  });

  it('skips a foot that is still swinging or lands on dry ground', () => {
    const swinging = waterContact(
      walker({ legs: [{ foot: { x: 3, z: 4 }, lifted: true }] }),
      [true],
      wet,
    );
    expect(swinging.strikes).toHaveLength(0);
    const bank = waterContact(walker(), [true], dry);
    expect(bank.strikes).toHaveLength(0);
    const held = waterContact(walker(), [false], wet);
    expect(held.strikes).toHaveLength(0);
  });
});

describe('water motion', () => {
  it('sprays and rings when a foot plants', () => {
    const contact = waterContact(walker({ speed: 1, waterDepth: 0.2 }), [true], wet);
    tickWater(now, contact);
    expect(waterWakes.some((wake) => wake.z === now && wake.w > 0.8)).toBe(true);
    expect(visibleDrops()).toBe(5);
    expect(visibleRings()).toBe(1);
    const drop = waterSplashes.children.find(
      (child) => child.name === 'water-drop' && child.visible,
    );
    expect(drop?.position.y).toBeGreaterThan(TERRAIN.water);
  });

  it('leaves a wake and a smaller spray while the body is moving', () => {
    const contact = waterContact(walker({ speed: 2, waterDepth: 0.5, legs: [] }), [], wet);
    advance(2, contact);
    expect(visibleDrops()).toBe(0);
    advance(1, contact);
    expect(waterPush.value).toBeGreaterThan(0.5);
    expect(visibleDrops()).toBe(3);
    expect(visibleRings()).toBeGreaterThan(0);
  });

  it('drops a quiet ring while the body floats still', () => {
    const contact = waterContact(walker({ speed: 0, waterDepth: 0.4, legs: [] }), [], wet);
    advance(10, contact);
    expect(visibleDrops()).toBe(0);
    expect(visibleRings()).toBe(0);
    advance(14, contact);
    expect(waterWakes.some((wake) => wake.w === 0.2)).toBe(true);
    expect(visibleDrops()).toBe(0);
    expect(visibleRings()).toBe(1);
  });

  it('lets a droplet fall back onto the sheet and then fade', () => {
    const contact = waterContact(walker({ speed: 0, waterDepth: 0.3 }), [true], wet);
    tickWater(now, contact);
    contact.strikes.length = 0;
    const drop = waterSplashes.children.find(
      (child) => child.name === 'water-drop' && child.visible,
    );
    const risen = drop?.position.y ?? 0;
    advance(4, contact);
    expect(drop?.position.y).toBeGreaterThan(risen);
    advance(12, contact);
    expect(drop?.position.y).toBeCloseTo(TERRAIN.water + 0.02);
    advance(20);
    expect(drop?.visible).toBe(false);
    expect(visibleRings()).toBe(0);
  });

  it('hides a ring when the clock jumps back before it was born', () => {
    const contact = waterContact(walker({ speed: 0, waterDepth: 0.3 }), [true], wet);
    tickWater(now, contact);
    expect(visibleRings()).toBe(1);
    tickWater(0);
    expect(visibleRings()).toBe(0);
  });
});
