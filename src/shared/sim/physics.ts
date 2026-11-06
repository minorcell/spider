import { Quaternion, Vector3 } from 'three';
import { PHYSICS } from '../config.js';
import { kindOf } from '../kinds.js';
import { BODY_RADIUS, blockedAt } from '../sight.js';
import { insideLand } from '../terrain.js';
import { sphereVolume, submergedFraction, WATER, waterAt } from '../water.js';
import type { EntityState, WorldState } from '../state.js';

// 松散的东西共用这一套：顺坡加速、被身体顶开、彼此挤开，碰到实体就停。
// 谁会动，写在这种东西自己的 physics.loose 上，不在这里点名。
//
// 竖直方向不按物体种类写死：每个 mover 都有质量、体积和碰撞球。水给出
// 排开体积的浮力，重力给出重量，两者相加得到加速度；水阻力按浸没比例缩放。

export interface Body {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
}

const EPS = 0.6;
const CLEARANCE = 0.08;
const MAX_FALL = 12;

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
  x0: number;
  z0: number;
  /** 这一步开始做竖直积分时的高度。落点被接住时用来丢掉下落速度。 */
  y0: number;
}

const spinQ = new Quaternion();
const spinDelta = new Quaternion();
const spinAxis = new Vector3();

/** Contact radius, mass, and volume of a loose body. Fixed kinds stay out. */
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
      mass: Math.max(1e-9, loose.mass),
      volume: Math.max(0, loose.volume),
      vx: entity.vx ?? 0,
      vy: entity.vy ?? 0,
      vz: entity.vz ?? 0,
      slope: 0,
      x0: entity.x,
      z0: entity.z,
      y0: entity.y,
    });
  }
  if (movers.length === 0) return;

  for (const mover of movers) {
    const { entity, radius, mass, volume } = mover;
    let { vx, vy, vz } = mover;
    const ground = world.terrain.height(entity.x, entity.z);
    const water = waterAt(world.terrain, entity.x, entity.z);
    const fraction = submergedFraction(entity.y, water.surface, radius);
    // How much of the body's weight the water carries: >1 means it is pushed up.
    const buoyancy = (fraction * WATER.density * volume) / mass;
    const grounded = entity.y <= ground + CLEARANCE + 1e-4;
    const floating = fraction > 0 && !grounded;
    const gx =
      (world.terrain.height(entity.x + EPS, entity.z) -
        world.terrain.height(entity.x - EPS, entity.z)) /
      (2 * EPS);
    const gz =
      (world.terrain.height(entity.x, entity.z + EPS) -
        world.terrain.height(entity.x, entity.z - EPS)) /
      (2 * EPS);
    const slope = Math.hypot(gx, gz);
    mover.slope = floating ? 0 : slope;
    // A body held by the water no longer follows the slope. A body still on the
    // bottom keeps only the part of gravity that buoyancy has not cancelled.
    const downhill = grounded ? rules.gravity * Math.max(0, 1 - buoyancy) : 0;
    // A steep face keeps accelerating a slow body. Zeroing that first shove
    // used to cancel the slope, so a gentle hill never got a body moving.
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
    mover.vy = vy;
    mover.vz = vz;
    entity.vx = vx;
    entity.vz = vz;
  }

  // Gravity and buoyancy own the vertical axis. Contacts run after, so a body
  // that has landed can still be lifted onto another body.
  for (const mover of movers) {
    if (!insideLand(world.terrain, mover.entity.x, mover.entity.z, mover.radius)) {
      mover.entity.x = mover.x0;
      mover.entity.z = mover.z0;
      mover.vx = 0;
      mover.vy = 0;
      mover.vz = 0;
    }
    const entity = mover.entity;
    mover.y0 = entity.y;
    const ground = world.terrain.height(entity.x, entity.z);
    const water = waterAt(world.terrain, entity.x, entity.z);
    const fraction = submergedFraction(entity.y, water.surface, mover.radius);
    const buoyancy = (fraction * WATER.density * mover.volume) / mover.mass;
    let vy = mover.vy + rules.gravity * (buoyancy - 1) * dt;
    vy *= Math.exp(-WATER.drag * fraction * dt);
    vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, vy));
    let y = entity.y + vy * dt;
    const floor = ground + CLEARANCE;
    if (y <= floor) {
      y = floor;
      if (vy < 0) vy = 0;
    }
    entity.y = y;
    entity.vy = vy;
    mover.vy = vy;
  }

  // 接触只改位置。叠在一起时沿三维法线分开，不再每帧加一截水平速度，
  // 否则堆着的苹果会一直抖，也永远睡不着。
  resolveContacts(movers, world);

  for (const mover of movers) {
    // 这一步没有真正下落，说明地面或别的东西把落点接住了。
    // 留下向下的速度的话，下一步会再扎进去，堆在一起就会抖。
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
  }
}

const CONTACT_STEPS = 6;

/** 把重叠的球分开。被挡住的那一段位移交给另一只。 */
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
    for (let j = i + 1; j < movers.length; j++) calmPair(movers[i], movers[j], world);
  }
}

/** 法线比这更陡，就是一只歇在另一只上面，不是并排挤开。 */
const SUPPORT = 0.45;

function separatePair(a: Mover, b: Mover, world: WorldState): boolean {
  const normal = contactNormal(a, b);
  if (!normal) return false;
  let { nx, ny, nz, depth } = normal;
  // 叠在一起时只沿竖直方向分开。斜着推会把上面那只慢慢挪走。
  // 球已经重叠时，竖直间距一定小于 needed，所以 depth 为正。
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

/** 消掉仍在相互靠近的速度。已经分开或贴着不动的，不再加一截速度。 */
function calmPair(a: Mover, b: Mover, world: WorldState): void {
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
  // 地面已经接住了这一只。它不该再分走一半下落速度，然后又交回去。
  if (ny > 0 && onGround(a, world)) invA = 0;
  if (ny < 0 && onGround(b, world)) invB = 0;
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

function onGround(mover: Mover, world: WorldState): boolean {
  return mover.entity.y <= world.terrain.height(mover.entity.x, mover.entity.z) + CLEARANCE + 1e-4;
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
  const dist = Math.hypot(dx, dy, dz);
  const min = a.radius + b.radius;
  if (dist >= min + slop) return null;
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
  const floor = world.terrain.height(x, z) + CLEARANCE;
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
