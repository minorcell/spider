import { PHYSICS } from '../config.js';
import { kindOf } from '../kinds.js';
import { BODY_RADIUS, blockedAt } from '../sight.js';
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
  vx: number;
  vz: number;
  slope: number;
}

/** Contact radius of a loose body. Fixed kinds stay out of the solver. */
function looseRadius(entity: EntityState): number | null {
  const physics = kindOf(entity.kind)?.physics;
  if (!physics?.loose) return null;
  return physics.radius;
}

export function stepPhysics(world: WorldState, body: Body, dt: number): void {
  if (dt <= 0) return;
  const rules = world.physics ?? PHYSICS;
  const movers: Mover[] = [];
  for (const entity of world.entities) {
    const radius = looseRadius(entity);
    if (radius === null) continue;
    movers.push({
      entity,
      radius,
      vx: entity.vx ?? 0,
      vz: entity.vz ?? 0,
      slope: 0,
    });
  }
  if (movers.length === 0) return;

  for (const mover of movers) {
    const { entity, radius } = mover;
    let { vx, vz } = mover;
    const gx =
      (world.terrain.height(entity.x + EPS, entity.z) -
        world.terrain.height(entity.x - EPS, entity.z)) /
      (2 * EPS);
    const gz =
      (world.terrain.height(entity.x, entity.z + EPS) -
        world.terrain.height(entity.x, entity.z - EPS)) /
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
      if (blockedAt(nx, nz, world.blocks, radius)) {
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
      if (!blockedAt(px, pz, world.blocks, radius)) {
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
    mover.entity.y = world.terrain.height(mover.entity.x, mover.entity.z) + CLEARANCE;
    if (mover.slope <= rules.sleepSlope && Math.hypot(mover.vx, mover.vz) < rules.sleepSpeed) {
      mover.entity.vx = 0;
      mover.entity.vz = 0;
    }
  }
}
