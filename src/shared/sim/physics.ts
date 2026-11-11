import { Quaternion, Vector3 } from 'three';
import { groundSupport } from '@/src/shared/contact';
import { CONTACT, PHYSICS } from '@/src/shared/config';
import { pullTether, type TetherMotion } from '@/src/shared/sim/tether';
import { kindOf } from '@/src/shared/kinds';
import {
  BODY_RADIUS,
  blockedAt,
  moveCircle,
  sweepCircle,
  sweepSpheres,
  surfaceLimit,
  type SphereMotion,
  type SphereHit,
  type MotionResult,
} from '@/src/shared/collision';
import { insideLand } from '@/src/shared/terrain';
import { sphereVolume, submergedFraction, WATER, waterAt } from '@/src/shared/water';
import type { EntityState, WorldState } from '@/src/shared/state';

export interface Body {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
  readonly radius?: number;
  /** Previous committed position; a missing path describes a stationary controller. */
  readonly from?: { x: number; z: number };
}

const EPS = 0.6;
const MAX_FALL = 12;

function floorAt(world: WorldState, x: number, z: number, radius: number): number {
  return groundSupport((px, pz) => world.terrain.height(px, pz), x, z, radius);
}

interface Mover {
  solid: boolean;
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
  pulled: boolean;
}

const spinQ = new Quaternion();
const spinDelta = new Quaternion();
const spinAxis = new Vector3();
const asleepBodies = new WeakMap<EntityState, number>();

function looseOf(entity: EntityState): {
  solid: boolean;
  radius: number;
  rolls: boolean;
  mass: number;
  volume: number;
} | null {
  const physics = kindOf(entity.kind)?.physics;
  if (!physics?.loose) return null;
  const volume = physics.volume ?? sphereVolume(physics.radius);
  return {
    solid: physics.solid,
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

export function fitsPlacement(world: WorldState, item: EntityState, x: number, z: number): boolean {
  const spec = kindOf(item.kind);
  const radius = spec?.physics?.radius ?? 0.2;
  if (!insideLand(world.terrain, x, z, Math.max(BODY_RADIUS, radius))) return false;
  if (spec?.physics?.solid === false) return true;
  if (blockedAt(x, z, world.blocks, radius)) return false;
  for (const other of world.entities.values()) {
    if (other === item) continue;
    const otherSpec = kindOf(other.kind);
    // Static shapes have already participated in the shared space query.
    if (otherSpec?.boxes || otherSpec?.block || otherSpec?.physics?.solid === false) continue;
    const separation = radius + (otherSpec?.physics?.radius ?? 0.2);
    if (Math.hypot(other.x - x, other.z - z) <= separation) return false;
  }
  return true;
}

export function stepPhysics(
  world: WorldState,
  body: Body,
  dt: number,
  anchor?: TetherMotion,
): { x: number; z: number } | undefined {
  if (dt <= 0) return;
  const rules = world.physics ?? PHYSICS;
  const resting = Math.abs(body.speed) < 0.05;
  const movers: Mover[] = [];
  for (const entity of world.entities.values()) {
    const loose = looseOf(entity);
    if (!loose) continue;
    const length = world.tethers.get(entity.id);
    const mass = Math.max(1e-9, loose.mass);
    const pulled =
      anchor !== undefined && length !== undefined && pullTether(entity, length, anchor, mass, dt);
    const vx = entity.vx ?? 0;
    const vy = entity.vy ?? 0;
    const vz = entity.vz ?? 0;
    const dx = entity.x - body.x;
    const dz = entity.z - body.z;
    const reach = (body.radius ?? BODY_RADIUS) + loose.radius;
    const asleep =
      (!body.from || (body.from.x === body.x && body.from.z === body.z)) &&
      resting &&
      asleepBodies.has(entity) &&
      vx === 0 &&
      vy === 0 &&
      vz === 0 &&
      dx * dx + dz * dz >= reach * reach;
    movers.push({
      solid: loose.solid,
      entity,
      radius: loose.radius,
      rolls: loose.rolls,
      mass,
      volume: Math.max(0, loose.volume),
      vx,
      vy,
      vz,
      slope: 0,
      floor: asleepBodies.get(entity) ?? 0,
      x0: entity.x,
      z0: entity.z,
      y0: entity.y,
      asleep,
      pulled,
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
    if (
      mover.pulled ||
      (!floating && slope > rules.sleepSlope) ||
      Math.hypot(vx, vz) >= rules.sleepSpeed
    ) {
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
    entity.y = Math.max(entity.y, mover.floor);
    entity.vy = vy;
    mover.vy = vy;
  }

  const reached = advanceMotion(movers, world, body, dt);
  pushFromController(movers, world, { ...body, ...reached });

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
    if (
      !mover.pulled &&
      mover.slope <= rules.sleepSlope &&
      Math.hypot(mover.vx, mover.vz) < rules.sleepSpeed
    ) {
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
    if (stayed) asleepBodies.set(mover.entity, mover.floor);
    else asleepBodies.delete(mover.entity);
  }
  return reached;
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
  applyPairImpulse(a, b, normal);
}

function applyPairImpulse(a: Mover, b: Mover, normal: Pick<SphereHit, 'nx' | 'ny' | 'nz'>): void {
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
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  // Ground support constrains the downward degree of freedom, not horizontal mass.
  const ay = ny > 0 && onGround(a) ? 0 : ny;
  const by = ny < 0 && onGround(b) ? 0 : ny;
  const horizontal = nx * nx + nz * nz;
  const inv = (horizontal + ny * ay) * invA + (horizontal + ny * by) * invB;
  const impulse = -rel / inv;
  a.vx -= nx * impulse * invA;
  a.vy -= ay * impulse * invA;
  a.vz -= nz * impulse * invA;
  b.vx += nx * impulse * invB;
  b.vy += by * impulse * invB;
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
  if (!a.solid || !b.solid) return null;
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
  const x0 = entity.x;
  const z0 = entity.z;
  moveBody(world, mover, dx, dz);
  const x = entity.x;
  const z = entity.z;
  const appliedX = x - x0;
  const appliedZ = z - z0;
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

function moveBody(world: WorldState, mover: Mover, dx: number, dz: number): MotionResult {
  const { entity, radius } = mover;
  const moved = moveCircle(entity.x, entity.z, dx, dz, radius, {
    blocks: world.blocks,
    inside: world.terrain.inside ? (x, z) => insideLand(world.terrain, x, z, radius) : undefined,
  });
  entity.x = moved.x;
  entity.z = moved.z;
  return moved;
}

function pushFromController(movers: Mover[], world: WorldState, body: Body): void {
  for (const mover of movers) {
    if (mover.asleep || !mover.solid) continue;
    const { entity, radius } = mover;
    const dx = entity.x - body.x;
    const dz = entity.z - body.z;
    const distance = Math.hypot(dx, dz);
    const contact = (body.radius ?? BODY_RADIUS) + radius;
    if (distance >= contact - 1e-8) continue;
    const nx = distance > 1e-6 ? dx / distance : 1;
    const nz = distance > 1e-6 ? dz / distance : 0;
    const moved = moveBody(
      world,
      mover,
      body.x + nx * contact - entity.x,
      body.z + nz * contact - entity.z,
    );
    const push = Math.max(1, body.speed * 0.8);
    const length = contact - distance;
    mover.vx = (moved.dx / length) * push;
    mover.vz = (moved.dz / length) * push;
    mover.floor = floorAt(world, entity.x, entity.z, radius);
    entity.y = Math.max(entity.y, mover.floor);
    syncVelocity(mover);
  }
}

type MotionEvent =
  | { kind: 'wall'; time: number; mover: Mover; nx: number; nz: number }
  | { kind: 'edge'; time: number; mover: Mover }
  | { kind: 'pair'; time: number; a: Mover; b: Mover; normal: SphereHit }
  | { kind: 'controller'; time: number; mover: Mover; normal: SphereHit };

/** All bodies share one timeline, including the controlled body's committed trajectory. */
function advanceMotion(
  movers: Mover[],
  world: WorldState,
  body: Body,
  dt: number,
): { x: number; z: number } {
  const from = body.from ?? body;
  let controllerVX = (body.x - from.x) / dt;
  let controllerVZ = (body.z - from.z) / dt;
  let controllerX = from.x;
  let controllerZ = from.z;
  let elapsed = 0;
  // Contact chains need repeated impulses to converge, especially against a fixed wall.
  // A pathological pile exhausts this bounded budget conservatively instead of tunnelling.
  const budget = Math.max(128, movers.length * 128);
  for (let iteration = 0; iteration < budget && elapsed < dt - 1e-10; iteration++) {
    const remaining = dt - elapsed;
    const trajectories: SphereMotion[] = movers.map((mover) => {
      const { entity, radius } = mover;
      const dx = mover.asleep ? 0 : mover.vx * remaining;
      const dz = mover.asleep ? 0 : mover.vz * remaining;
      const floor =
        dx !== 0 || dz !== 0 ? floorAt(world, entity.x + dx, entity.z + dz, radius) : mover.floor;
      const dy = mover.asleep ? 0 : Math.max(mover.vy * remaining, floor - entity.y);
      if (dy === 0 && mover.vy < 0) mover.vy = 0;
      return {
        x: entity.x,
        y: entity.y + radius,
        z: entity.z,
        radius,
        dx,
        dy,
        dz,
      };
    });
    let event: MotionEvent | null = null;
    const offer = (candidate: MotionEvent): void => {
      if (!event || candidate.time < event.time) event = candidate;
    };
    const controller: SphereMotion = {
      x: controllerX,
      y: 0,
      z: controllerZ,
      dx: controllerVX * remaining,
      dy: 0,
      dz: controllerVZ * remaining,
      radius: body.radius ?? BODY_RADIUS,
    };
    for (let i = 0; i < movers.length; i++) {
      const mover = movers[i];
      const path = trajectories[i];
      if (!mover.asleep) {
        const obstacle = firstObstacle(mover, world, path);
        if (obstacle) offer(obstacle);
      }
      if (!mover.solid) continue;
      // Controllers currently use a vertical column; loose bodies use full 3D spheres.
      const controllerHit = sweepSpheres(controller, { ...path, y: 0, dy: 0 });
      if (controllerHit)
        offer({ kind: 'controller', time: controllerHit.time, mover, normal: controllerHit });
      for (let j = i + 1; j < movers.length; j++) {
        if (!movers[j].solid || (mover.asleep && movers[j].asleep)) continue;
        const normal = sweepSpheres(path, trajectories[j]);
        if (normal) offer({ kind: 'pair', time: normal.time, a: mover, b: movers[j], normal });
      }
    }
    // The helper records the first event; TS cannot infer assignments through the callback.
    const first = event as MotionEvent | null;
    const fraction = first?.time ?? 1;
    controllerX += controller.dx * fraction;
    controllerZ += controller.dz * fraction;
    for (let i = 0; i < movers.length; i++) {
      const mover = movers[i];
      if (mover.asleep) continue;
      const path = trajectories[i];
      mover.entity.x += path.dx * fraction;
      mover.entity.z += path.dz * fraction;
      if (path.dx !== 0 || path.dz !== 0)
        mover.floor = floorAt(world, mover.entity.x, mover.entity.z, mover.radius);
      mover.entity.y = Math.max(mover.floor, mover.entity.y + path.dy * fraction);
      if (onGround(mover) && mover.vy < 0) mover.vy = 0;
      syncVelocity(mover);
    }
    elapsed += remaining * fraction;
    if (!first) break;
    if (first.kind === 'pair') {
      first.a.asleep = first.b.asleep = false;
      applyPairImpulse(first.a, first.b, first.normal);
    } else if (first.kind === 'controller') {
      const { mover, normal } = first;
      const approach =
        (mover.vx - controllerVX) * normal.nx + (mover.vz - controllerVZ) * normal.nz;
      mover.vx -= Math.min(0, approach) * normal.nx;
      mover.vz -= Math.min(0, approach) * normal.nz;
      mover.asleep = false;
      const obstacle = firstObstacle(mover, world, {
        x: mover.entity.x,
        z: mover.entity.z,
        dx: mover.vx * (dt - elapsed),
        dz: mover.vz * (dt - elapsed),
        radius: mover.radius,
      });
      if (obstacle && obstacle.time <= 1e-8) {
        // A pinned body constrains the controller too; other bodies still finish this step.
        controllerVX = controllerVZ = 0;
        stopAtObstacle(obstacle);
      }
      syncVelocity(mover);
    } else {
      stopAtObstacle(first);
    }
  }
  return { x: controllerX, z: controllerZ };
}

type Obstacle = Extract<MotionEvent, { kind: 'wall' | 'edge' }>;

function firstObstacle(
  mover: Mover,
  world: WorldState,
  path: Pick<SphereMotion, 'x' | 'z' | 'dx' | 'dz' | 'radius'>,
): Obstacle | null {
  const wall = mover.solid
    ? sweepCircle(path.x, path.z, path.dx, path.dz, path.radius, world.blocks)
    : null;
  const edge = world.terrain.inside
    ? surfaceLimit(path.x, path.z, path.dx, path.dz, {
        blocks: world.blocks,
        inside: (x, z) => insideLand(world.terrain, x, z, path.radius),
      })
    : null;
  if (edge && (!wall || edge.time <= wall.time)) return { kind: 'edge', time: edge.time, mover };
  return wall ? { kind: 'wall', time: wall.time, mover, nx: wall.nx, nz: wall.nz } : null;
}

function stopAtObstacle(obstacle: Obstacle): void {
  const { mover } = obstacle;
  if (obstacle.kind === 'edge') mover.vx = mover.vz = 0;
  else {
    const approach = mover.vx * obstacle.nx + mover.vz * obstacle.nz;
    mover.vx -= approach * obstacle.nx;
    mover.vz -= approach * obstacle.nz;
  }
  syncVelocity(mover);
}
