import { Quaternion, Vector3 } from 'three';
import { PHYSICS } from '../config.js';
import { kindOf } from '../kinds.js';
import { BODY_RADIUS, blockedAt } from '../sight.js';
import { insideLand, surfaceOf } from '../terrain.js';
import type { EntityState, WorldState } from '../state.js';

// 松散的东西共用这一套：顺坡加速、被身体顶开、彼此挤开，碰到实体就停。
// 谁会动，写在这种东西自己的 physics.loose 上，不在这里点名。

export interface Body {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
}

const EPS = 0.6;
const CLEARANCE = 0.08;

interface Mover {
  entity: EntityState;
  radius: number;
  rolls: boolean;
  vx: number;
  vz: number;
  slope: number;
  x0: number;
  z0: number;
}

const spinQ = new Quaternion();
const spinDelta = new Quaternion();
const spinAxis = new Vector3();

/** Contact radius of a loose body. Fixed kinds stay out of the solver. */
function looseOf(entity: EntityState): { radius: number; rolls: boolean } | null {
  const physics = kindOf(entity.kind)?.physics;
  if (!physics?.loose) return null;
  return { radius: physics.radius, rolls: physics.rolls };
}

/** Turn a round body by the arc length of this step, around the axis across its travel. */
function roll(entity: EntityState, radius: number, dx: number, dz: number): void {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-8 || radius <= 0) return;
  // Up × travel. Positive travel on +X spins so the bottom kicks backward.
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
  const movers: Mover[] = [];
  for (const entity of world.entities) {
    const loose = looseOf(entity);
    if (!loose) continue;
    movers.push({
      entity,
      radius: loose.radius,
      rolls: loose.rolls,
      vx: entity.vx ?? 0,
      vz: entity.vz ?? 0,
      slope: 0,
      x0: entity.x,
      z0: entity.z,
    });
  }
  if (movers.length === 0) return;

  for (const mover of movers) {
    const { entity, radius } = mover;
    let { vx, vz } = mover;
    const gx =
      (surfaceOf(world.terrain, entity.x + EPS, entity.z) -
        surfaceOf(world.terrain, entity.x - EPS, entity.z)) /
      (2 * EPS);
    const gz =
      (surfaceOf(world.terrain, entity.x, entity.z + EPS) -
        surfaceOf(world.terrain, entity.x, entity.z - EPS)) /
      (2 * EPS);
    const slope = Math.hypot(gx, gz);
    mover.slope = slope;
    // A steep face keeps accelerating a slow body. Zeroing that first shove
    // used to cancel the slope, so a gentle hill never got a body moving.
    if (slope > rules.sleepSlope || Math.hypot(vx, vz) >= rules.sleepSpeed) {
      vx -= gx * rules.gravity * dt;
      vz -= gz * rules.gravity * dt;
      const drag = Math.exp(-rules.damping * dt);
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

    // The spider shoves a loose body out. A wall on that side wins.
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
    mover.vz = vz;
    entity.vx = vx;
    entity.vz = vz;
  }

  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i];
      const b = movers[j];
      const dx = b.entity.x - a.entity.x;
      const dz = b.entity.z - a.entity.z;
      const distance = Math.hypot(dx, dz);
      const min = a.radius + b.radius;
      if (distance >= min || distance < 1e-6) continue;
      const nx = dx / distance;
      const nz = dz / distance;
      const shift = (min - distance) / 2;
      a.entity.x -= nx * shift;
      a.entity.z -= nz * shift;
      b.entity.x += nx * shift;
      b.entity.z += nz * shift;
      a.vx -= nx * 0.4;
      a.vz -= nz * 0.4;
      b.vx += nx * 0.4;
      b.vz += nz * 0.4;
      a.entity.vx = a.vx;
      a.entity.vz = a.vz;
      b.entity.vx = b.vx;
      b.entity.vz = b.vz;
    }
  }

  // Sit on the ground. Sleep only when the slope will not wake the body.
  for (const mover of movers) {
    if (!insideLand(world.terrain, mover.entity.x, mover.entity.z, mover.radius)) {
      mover.entity.x = mover.x0;
      mover.entity.z = mover.z0;
      mover.vx = 0;
      mover.vz = 0;
    }
    mover.entity.y = surfaceOf(world.terrain, mover.entity.x, mover.entity.z) + CLEARANCE;
    if (mover.rolls) {
      roll(mover.entity, mover.radius, mover.entity.x - mover.x0, mover.entity.z - mover.z0);
    }
    if (mover.slope <= rules.sleepSlope && Math.hypot(mover.vx, mover.vz) < rules.sleepSpeed) {
      mover.entity.vx = 0;
      mover.entity.vz = 0;
    }
  }
}
