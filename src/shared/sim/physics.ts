import { Quaternion, Vector3 } from 'three';
import { groundSupport } from '../contact.js';
import { CONTACT, PHYSICS } from '../config.js';
import { kindOf } from '../kinds.js';
import { BODY_RADIUS, blockedAt } from '../sight.js';
import { insideLand } from '../terrain.js';
import { sphereVolume, submergedFraction, WATER, waterAt } from '../water.js';
import type { EntityState, WorldState } from '../state.js';

export interface Body {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
}

const EPS = 0.6;
const MAX_FALL = 12;

function floorAt(world: WorldState, x: number, z: number, radius: number): number {
  return groundSupport((px, pz) => world.terrain.height(px, pz), x, z, radius);
}

interface Mover {
  entity: EntityState;
  radius: number;
  rolls: boolean;
  mass: number;
  volume: number;
  vx: number;
  vy: number;
  vz: number;
  slope: number;
  floor: number;
  x0: number;
  z0: number;
  y0: number;
  asleep: boolean;
}

const spinQ = new Quaternion();
const spinDelta = new Quaternion();
const spinAxis = new Vector3();
const asleepBodies = new WeakSet<EntityState>();

function looseOf(entity: EntityState): {
  radius: number;
  rolls: boolean;
  mass: number;
  volume: number;
} | null {
  const physics = kindOf(entity.kind)?.physics;
  if (!physics?.loose) return null;
  const volume = physics.volume ?? sphereVolume(physics.radius);
  return {
    radius: physics.radius,
    rolls: physics.rolls,
    mass: physics.mass ?? volume,
    volume,
  };
}

function roll(entity: EntityState, radius: number, dx: number, dz: number): void {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-8 || radius <= 0) return;
  spinAxis.set(dz / dist, 0, -dx / dist);
  spinDelta.setFromAxisAngle(spinAxis, dist / radius);
  spinQ.set(entity.qx ?? 0, entity.qy ?? 0, entity.qz ?? 0, entity.qw ?? 1);
  spinQ.premultiply(spinDelta).normalize();
  entity.qx = spinQ.x;
  entity.qy = spinQ.y;
  entity.qz = spinQ.z;
  entity.qw = spinQ.w;
}

export function stepPhysics(world: WorldState, body: Body, dt: number): void {
  if (dt <= 0) return;
  const rules = world.physics ?? PHYSICS;
  const resting = Math.abs(body.speed) < 0.05;
  const movers: Mover[] = [];
  for (const entity of world.entities) {
    const loose = looseOf(entity);
    if (!loose) continue;
    const vx = entity.vx ?? 0;
    const vy = entity.vy ?? 0;
    const vz = entity.vz ?? 0;
    const dx = entity.x - body.x;
    const dz = entity.z - body.z;
    const reach = BODY_RADIUS + loose.radius;
    const asleep =
      resting &&
      asleepBodies.has(entity) &&
      vx === 0 &&
      vy === 0 &&
      vz === 0 &&
      dx * dx + dz * dz >= reach * reach;
    movers.push({
      entity,
      radius: loose.radius,
      rolls: loose.rolls,
      mass: Math.max(1e-9, loose.mass),
      volume: Math.max(0, loose.volume),
      vx,
      vy,
      vz,
      slope: 0,
      floor: 0,
      x0: entity.x,
      z0: entity.z,
      y0: entity.y,
      asleep,
    });
  }
  if (movers.length === 0) return;

  for (const mover of movers) {
    if (mover.asleep) continue;
    const { entity, radius, mass, volume } = mover;
    let { vx, vy, vz } = mover;
    const water = waterAt(world.terrain, entity.x, entity.z);
    const fraction = submergedFraction(entity.y, water.surface, radius);
    const buoyancy = (fraction * WATER.density * volume) / mass;
    const gx =
      (world.terrain.height(entity.x + EPS, entity.z) -
        world.terrain.height(entity.x - EPS, entity.z)) /
      (2 * EPS);
    const gz =
      (world.terrain.height(entity.x, entity.z + EPS) -
        world.terrain.height(entity.x, entity.z - EPS)) /
      (2 * EPS);
    const ground = world.terrain.height(entity.x, entity.z);
    const floor =
      radius <= 0 ? ground : ground + radius * (Math.sqrt(1 + gx * gx + gz * gz) - 1) + CONTACT;
    mover.floor = floor;
    const grounded = entity.y <= floor + 1e-4;
    const floating = fraction > 0 && !grounded;
    const slope = Math.hypot(gx, gz);
    mover.slope = floating ? 0 : slope;
    const downhill = grounded ? rules.gravity * Math.max(0, 1 - buoyancy) : 0;
    if ((!floating && slope > rules.sleepSlope) || Math.hypot(vx, vz) >= rules.sleepSpeed) {
      vx -= gx * downhill * dt;
      vz -= gz * downhill * dt;
      const drag = Math.exp(-(rules.damping + WATER.drag * fraction) * dt);
      vx *= drag;
      vz *= drag;
      const speed = Math.hypot(vx, vz);
      if (speed > rules.maxSpeed) {
        vx = (vx / speed) * rules.maxSpeed;
        vz = (vz / speed) * rules.maxSpeed;
      }
      const nx = entity.x + vx * dt;
      const nz = entity.z + vz * dt;
      if (blockedAt(nx, nz, world.blocks, radius) || !insideLand(world.terrain, nx, nz, radius)) {
        vx = 0;
        vz = 0;
      } else {
        entity.x = nx;
        entity.z = nz;
      }
    }

    const dx = entity.x - body.x;
    const dz = entity.z - body.z;
    const distance = Math.hypot(dx, dz);
    const contact = BODY_RADIUS + radius;
    if (distance < contact) {
      const free = distance > 1e-6;
      const nx = free ? dx / distance : 1;
      const nz = free ? dz / distance : 0;
      const px = body.x + nx * contact;
      const pz = body.z + nz * contact;
      if (!blockedAt(px, pz, world.blocks, radius) && insideLand(world.terrain, px, pz, radius)) {
        entity.x = px;
        entity.z = pz;
        const push = Math.max(1, body.speed * 0.8);
        vx = nx * push;
        vz = nz * push;
      }
    }
    mover.vx = vx;
    mover.vy = vy;
    mover.vz = vz;
    entity.vx = vx;
    entity.vz = vz;
  }

  for (const mover of movers) {
    if (mover.asleep) continue;
    if (!insideLand(world.terrain, mover.entity.x, mover.entity.z, mover.radius)) {
      mover.entity.x = mover.x0;
      mover.entity.z = mover.z0;
      mover.vx = 0;
      mover.vy = 0;
      mover.vz = 0;
    }
    const entity = mover.entity;
    mover.y0 = entity.y;
    const water = waterAt(world.terrain, entity.x, entity.z);
    const fraction = submergedFraction(entity.y, water.surface, mover.radius);
    const buoyancy = (fraction * WATER.density * mover.volume) / mover.mass;
    let vy = mover.vy + rules.gravity * (buoyancy - 1) * dt;
    vy *= Math.exp(-WATER.drag * fraction * dt);
    vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, vy));
    let y = entity.y + vy * dt;
    let floor = mover.floor;
    const slid = (entity.x - mover.x0) ** 2 + (entity.z - mover.z0) ** 2 > 0;
    if (slid) {
      floor = floorAt(world, entity.x, entity.z, mover.radius);
      mover.floor = floor;
    }
    if (y <= floor) {
      y = floor;
      if (vy < 0) vy = 0;
    }
    entity.y = y;
    entity.vy = vy;
    mover.vy = vy;
  }

  if (movers.some((mover) => !mover.asleep)) resolveContacts(movers, world);

  for (const mover of movers) {
    if (mover.vy < 0 && mover.entity.y >= mover.y0 - 1e-4) {
      mover.vy = 0;
      mover.entity.vy = 0;
    }
  }

  for (const mover of movers) {
    if (mover.rolls) {
      roll(mover.entity, mover.radius, mover.entity.x - mover.x0, mover.entity.z - mover.z0);
    }
    if (mover.slope <= rules.sleepSlope && Math.hypot(mover.vx, mover.vz) < rules.sleepSpeed) {
      mover.entity.vx = 0;
      mover.entity.vz = 0;
      mover.vx = 0;
      mover.vz = 0;
    }
    if (!resting) continue;
    const stayed =
      mover.entity.x === mover.x0 &&
      mover.entity.y === mover.y0 &&
      mover.entity.z === mover.z0 &&
      mover.vx === 0 &&
      mover.vy === 0 &&
      mover.vz === 0 &&
      mover.slope <= rules.sleepSlope;
    if (stayed) asleepBodies.add(mover.entity);
    else asleepBodies.delete(mover.entity);
  }
}

const CONTACT_STEPS = 6;

function resolveContacts(movers: Mover[], world: WorldState): void {
  for (let step = 0; step < CONTACT_STEPS; step++) {
    let overlapped = false;
    for (let i = 0; i < movers.length; i++) {
      for (let j = i + 1; j < movers.length; j++) {
        if (separatePair(movers[i], movers[j], world)) overlapped = true;
      }
    }
    if (!overlapped) break;
  }
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) calmPair(movers[i], movers[j]);
  }
}

const SUPPORT = 0.45;

function separatePair(a: Mover, b: Mover, world: WorldState): boolean {
  const normal = contactNormal(a, b);
  if (!normal) return false;
  let { nx, ny, nz, depth } = normal;
  if (Math.abs(ny) >= SUPPORT) {
    const horizontal = Math.hypot(b.entity.x - a.entity.x, b.entity.z - a.entity.z);
    const min = a.radius + b.radius;
    const needed = Math.sqrt(Math.max(0, min * min - horizontal * horizontal));
    const have = Math.abs(b.entity.y + b.radius - (a.entity.y + a.radius));
    nx = 0;
    nz = 0;
    ny = ny >= 0 ? 1 : -1;
    depth = needed - have;
  }
  const half = depth / 2;
  const wantAx = -nx * half;
  const wantAy = -ny * half;
  const wantAz = -nz * half;
  const wantBx = nx * half;
  const wantBy = ny * half;
  const wantBz = nz * half;
  const gotA = moveBy(a, world, wantAx, wantAy, wantAz);
  const gotB = moveBy(b, world, wantBx, wantBy, wantBz);
  const leftAx = wantAx - gotA.dx;
  const leftAy = wantAy - gotA.dy;
  const leftAz = wantAz - gotA.dz;
  const leftBx = wantBx - gotB.dx;
  const leftBy = wantBy - gotB.dy;
  const leftBz = wantBz - gotB.dz;
  if (leftBx !== 0 || leftBy !== 0 || leftBz !== 0) moveBy(a, world, -leftBx, -leftBy, -leftBz);
  if (leftAx !== 0 || leftAy !== 0 || leftAz !== 0) moveBy(b, world, -leftAx, -leftAy, -leftAz);
  return true;
}

function calmPair(a: Mover, b: Mover): void {
  const normal = contactNormal(a, b, 1e-4);
  if (!normal) return;
  let { nx, ny, nz } = normal;
  if (Math.abs(ny) >= SUPPORT) {
    const mass = a.mass + b.mass;
    const vx = (a.vx * a.mass + b.vx * b.mass) / mass;
    const vz = (a.vz * a.mass + b.vz * b.mass) / mass;
    a.vx = b.vx = vx;
    a.vz = b.vz = vz;
    nx = 0;
    nz = 0;
    ny = ny >= 0 ? 1 : -1;
  }
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
  if (rel >= 0) {
    syncVelocity(a);
    syncVelocity(b);
    return;
  }
  let invA = 1 / a.mass;
  let invB = 1 / b.mass;
  if (ny > 0 && onGround(a)) invA = 0;
  if (ny < 0 && onGround(b)) invB = 0;
  const inv = invA + invB;
  const impulse = -rel / inv;
  a.vx -= nx * impulse * invA;
  a.vy -= ny * impulse * invA;
  a.vz -= nz * impulse * invA;
  b.vx += nx * impulse * invB;
  b.vy += ny * impulse * invB;
  b.vz += nz * impulse * invB;
  syncVelocity(a);
  syncVelocity(b);
}

function onGround(mover: Mover): boolean {
  return mover.entity.y <= mover.floor + 1e-4;
}

function syncVelocity(mover: Mover): void {
  mover.entity.vx = mover.vx;
  mover.entity.vy = mover.vy;
  mover.entity.vz = mover.vz;
}

function contactNormal(
  a: Mover,
  b: Mover,
  slop = 0,
): { nx: number; ny: number; nz: number; depth: number } | null {
  const dx = b.entity.x - a.entity.x;
  const dy = b.entity.y + b.radius - (a.entity.y + a.radius);
  const dz = b.entity.z - a.entity.z;
  const min = a.radius + b.radius;
  const reach = min + slop;
  if (Math.abs(dx) >= reach || Math.abs(dy) >= reach || Math.abs(dz) >= reach) return null;
  const squared = dx * dx + dy * dy + dz * dz;
  if (squared >= reach * reach) return null;
  const dist = Math.sqrt(squared);
  if (dist < 1e-8) return { nx: 1, ny: 0, nz: 0, depth: min - dist };
  return { nx: dx / dist, ny: dy / dist, nz: dz / dist, depth: min - dist };
}

function moveBy(
  mover: Mover,
  world: WorldState,
  dx: number,
  dy: number,
  dz: number,
): { dx: number; dy: number; dz: number } {
  const entity = mover.entity;
  let x = entity.x;
  let z = entity.z;
  let appliedX = 0;
  let appliedZ = 0;
  if (dx !== 0 || dz !== 0) {
    const nextX = entity.x + dx;
    const nextZ = entity.z + dz;
    if (
      !blockedAt(nextX, nextZ, world.blocks, mover.radius) &&
      insideLand(world.terrain, nextX, nextZ, mover.radius)
    ) {
      x = nextX;
      z = nextZ;
      appliedX = dx;
      appliedZ = dz;
    }
  }
  const nextY = entity.y + dy;
  const floor = floorAt(world, x, z, mover.radius);
  mover.floor = floor;
  let y = nextY;
  let appliedY = dy;
  if (nextY < floor) {
    y = floor;
    appliedY = floor - entity.y;
  }
  entity.x = x;
  entity.y = y;
  entity.z = z;
  return { dx: appliedX, dy: appliedY, dz: appliedZ };
}
