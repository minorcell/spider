import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector4,
} from 'three';
import { uniform, uniformArray } from 'three/tsl';
import { PALETTE } from '../shared/config.js';
import { TERRAIN } from '../shared/terrain.js';
import { waterAt } from '../shared/water.js';

/**
 * Disturbances on the sheet. Swells are displaced in the water material;
 * each hit here becomes one expanding ring plus a short spray of droplets.
 * Six rings is the usual small ring buffer: old impulses fall off and get reused.
 */
export const WAKE_COUNT = 6;

const wakeSlots = Array.from({ length: WAKE_COUNT }, () => new Vector4(0, 0, -1000, 0));

/** World x, world z, birth time, strength. The water shader reads this every frame. */
export const waterWake = uniformArray<'vec4'>(wakeSlots, 'vec4');
export const waterBodyX = uniform(0);
export const waterBodyZ = uniform(0);
export const waterDirX = uniform(0);
export const waterDirZ = uniform(-1);
/** 0 on dry ground, up to 1 at a run. Scales the bow wave under the body. */
export const waterPush = uniform(0);

export interface WaterStrike {
  readonly x: number;
  readonly z: number;
  readonly power: number;
}

export interface WaterContact {
  x: number;
  z: number;
  speed: number;
  depth: number;
  dirX: number;
  dirZ: number;
  readonly strikes: WaterStrike[];
}

export interface WaterWalker {
  readonly root: { readonly position: { readonly x: number; readonly z: number } };
  readonly yaw: number;
  readonly speed: number;
  readonly waterDepth: number;
  readonly legs: readonly {
    readonly foot: { readonly x: number; readonly z: number };
    readonly lifted: boolean;
  }[];
}

const strikeBuffer: WaterStrike[] = [];
const contactBuffer: WaterContact = {
  x: 0,
  z: 0,
  speed: 0,
  depth: 0,
  dirX: 0,
  dirZ: -1,
  strikes: strikeBuffer,
};

/**
 * Where the body is, and which feet just planted in water.
 * The returned object is reused; read it before the next call.
 */
export function waterContact(
  spider: WaterWalker,
  wasLifted: readonly boolean[],
  world: { terrain: { height(x: number, z: number): number } } | null,
): WaterContact {
  strikeBuffer.length = 0;
  contactBuffer.x = spider.root.position.x;
  contactBuffer.z = spider.root.position.z;
  contactBuffer.speed = spider.speed;
  contactBuffer.dirX = -Math.sin(spider.yaw);
  contactBuffer.dirZ = -Math.cos(spider.yaw);
  contactBuffer.depth = world ? spider.waterDepth : 0;
  if (world) {
    const legs = spider.legs;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (!(wasLifted[i] && !leg.lifted)) continue;
      const foot = leg.foot;
      if (waterAt(world.terrain, foot.x, foot.z).depth <= 0) continue;
      strikeBuffer.push({
        x: foot.x,
        z: foot.z,
        power: 0.85 + Math.min(0.25, spider.speed * 0.15),
      });
    }
  }
  return contactBuffer;
}

const RING_POINTS = 28;
const DROP_COUNT = 16;
const SURFACE_Y = TERRAIN.water + 0.02;

export const waterSplashes = new Group();
waterSplashes.name = 'water-splash';
waterSplashes.userData.retainGeometry = true;

const dropGeometry = new SphereGeometry(1, 7, 5);

interface Ring {
  readonly line: LineLoop;
  readonly position: BufferAttribute;
  readonly material: LineBasicMaterial;
}

interface Drop {
  readonly mesh: Mesh;
  readonly streak: Line;
  readonly streakPos: BufferAttribute;
  readonly material: MeshBasicMaterial;
  readonly streakMaterial: LineBasicMaterial;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  originX: number;
  originZ: number;
  age: number;
  life: number;
}

function makeRing(): Ring {
  const position = new Float32BufferAttribute(RING_POINTS * 3, 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', position);
  const material = new LineBasicMaterial({
    color: PALETTE.ink,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const line = new LineLoop(geometry, material);
  line.name = 'water-ring';
  line.frustumCulled = false;
  line.renderOrder = 2;
  line.visible = false;
  waterSplashes.add(line);
  return { line, position, material };
}

function makeDrop(): Drop {
  const material = new MeshBasicMaterial({
    color: PALETTE.paper,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new Mesh(dropGeometry, material);
  mesh.name = 'water-drop';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;
  const streakPos = new Float32BufferAttribute(6, 3);
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute('position', streakPos);
  const streakMaterial = new LineBasicMaterial({
    color: PALETTE.ink,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const streak = new Line(streakGeometry, streakMaterial);
  streak.name = 'water-streak';
  streak.frustumCulled = false;
  streak.renderOrder = 2;
  streak.visible = false;
  waterSplashes.add(mesh, streak);
  return {
    mesh,
    streak,
    streakPos,
    material,
    streakMaterial,
    x: 0,
    y: SURFACE_Y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    originX: 0,
    originZ: 0,
    age: 1,
    life: 1,
  };
}

const rings = Array.from({ length: WAKE_COUNT }, () => makeRing());
const drops = Array.from({ length: DROP_COUNT }, () => makeDrop());

let wakeCursor = 0;
let dropCursor = 0;
let sprayAngle = 0;
let travel = 0;
let stillFor = 0;

function pushWake(x: number, z: number, time: number, power: number): void {
  wakeSlots[wakeCursor].set(x, z, time, power);
  wakeCursor = (wakeCursor + 1) % WAKE_COUNT;
}

function spray(x: number, z: number, power: number): void {
  const count = power >= 0.75 ? 5 : 3;
  for (let i = 0; i < count; i++) {
    const drop = drops[dropCursor];
    dropCursor = (dropCursor + 1) % DROP_COUNT;
    const angle = sprayAngle;
    sprayAngle += 2.399963;
    const speed = 0.4 + power * 0.75;
    drop.x = x;
    drop.y = SURFACE_Y;
    drop.z = z;
    drop.originX = x;
    drop.originZ = z;
    drop.vx = Math.cos(angle) * speed * 0.55;
    drop.vz = Math.sin(angle) * speed * 0.55;
    drop.vy = 1.15 + power * 1.45;
    drop.age = 0;
    drop.life = 0.4 + power * 0.22;
    drop.mesh.visible = true;
    drop.streak.visible = true;
  }
}

function drive(contact: WaterContact, time: number, dt: number): void {
  waterBodyX.value = contact.x;
  waterBodyZ.value = contact.z;
  waterDirX.value = contact.dirX;
  waterDirZ.value = contact.dirZ;
  waterPush.value = contact.depth > 0.02 ? Math.min(1, contact.speed / 1.8) : 0;
  for (const strike of contact.strikes) {
    pushWake(strike.x, strike.z, time, strike.power);
    spray(strike.x, strike.z, strike.power);
  }
  const wading = contact.depth > 0.02;
  const moving = wading && contact.speed > 0.22;
  if (moving) {
    stillFor = 0;
    travel += contact.speed * dt;
    if (travel >= 0.3) {
      travel -= 0.3;
      const power = 0.5 + Math.min(0.2, contact.speed * 0.08);
      pushWake(contact.x, contact.z, time, power);
      spray(contact.x, contact.z, power);
    }
    return;
  }
  travel = 0;
  if (!wading) {
    stillFor = 0;
    return;
  }
  stillFor += dt;
  if (stillFor < 1.1) return;
  stillFor = 0;
  pushWake(contact.x, contact.z, time, 0.2);
}

function stepDrops(dt: number): void {
  for (const drop of drops) {
    drop.age += dt;
    if (drop.age >= drop.life) {
      drop.mesh.visible = false;
      drop.streak.visible = false;
      continue;
    }
    drop.vy -= 9.8 * dt;
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    drop.z += drop.vz * dt;
    if (drop.y < SURFACE_Y) {
      drop.y = SURFACE_Y;
      drop.vy *= -0.2;
      drop.vx *= 0.45;
      drop.vz *= 0.45;
    }
    const fade = 1 - drop.age / drop.life;
    drop.mesh.visible = true;
    drop.streak.visible = true;
    drop.mesh.position.set(drop.x, drop.y, drop.z);
    drop.mesh.scale.setScalar(0.016 + fade * 0.03);
    drop.material.opacity = 0.9 * fade;
    drop.streakPos.setXYZ(0, drop.originX, SURFACE_Y, drop.originZ);
    drop.streakPos.setXYZ(1, drop.x, drop.y, drop.z);
    drop.streakPos.needsUpdate = true;
    drop.streakMaterial.opacity = 0.55 * fade;
  }
}

function stepRings(time: number): void {
  for (let i = 0; i < WAKE_COUNT; i++) {
    const slot = wakeSlots[i];
    const ring = rings[i];
    const age = time - slot.z;
    const fade = slot.w * Math.exp(-age * 0.9);
    if (age < 0 || age > 1.7 || fade < 0.04) {
      ring.line.visible = false;
      continue;
    }
    ring.line.visible = true;
    ring.material.opacity = Math.min(0.5, fade);
    const radius = 0.12 + age * 1.7;
    const position = ring.position;
    for (let point = 0; point < RING_POINTS; point++) {
      const angle = (point / RING_POINTS) * Math.PI * 2;
      const wobble = 1 + 0.05 * Math.sin(angle * 3 + slot.z);
      position.setXYZ(
        point,
        slot.x + Math.cos(angle) * radius * wobble,
        TERRAIN.water + 0.06,
        slot.y + Math.sin(angle) * radius * wobble,
      );
    }
    position.needsUpdate = true;
  }
}

/** Move rings and droplets, and record any new contact from this frame. */
export function applyWaterMotion(seconds: number, dt: number, contact?: WaterContact): void {
  if (contact) drive(contact, seconds, dt);
  else {
    travel = 0;
    stillFor = 0;
  }
  stepDrops(dt);
  stepRings(seconds);
}

export { wakeSlots as waterWakes };
