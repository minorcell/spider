import { recordWorldChange, type ReleaseCause } from '@/src/shared/changes';
import { kindOf } from '@/src/shared/kinds';
import { sphereVolume } from '@/src/shared/water';
import type { EntityState, TetherRelation, Vec3, WorldState } from '@/src/shared/state';

type Relations = Pick<WorldState, 'entities' | 'tethers'>;

/** Transform a registered local attachment into the same world point used by physics and drawing. */
export function tetherAnchor(entity: EntityState, local: Vec3): Vec3 {
  let { x, y, z } = local;
  if (entity.control) {
    const c = Math.cos(entity.control.yaw);
    const s = Math.sin(entity.control.yaw);
    x = local.x * c + local.z * s;
    z = local.z * c - local.x * s;
  } else {
    const physics = kindOf(entity.kind)?.physics;
    const pivot = physics?.rolls ? physics.radius : 0;
    y -= pivot;
    const qx = entity.qx ?? 0;
    const qy = entity.qy ?? 0;
    const qz = entity.qz ?? 0;
    const qw = entity.qw ?? 1;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    x += qw * tx + qy * tz - qz * ty;
    y += qw * ty + qz * tx - qx * tz + pivot;
    z += qw * tz + qx * ty - qy * tx;
  }
  return { x: entity.x + x, y: entity.y + y, z: entity.z + z };
}

export function tetherEndpoints(world: Relations, relation: TetherRelation) {
  const source = world.entities.get(relation.sourceId);
  const target = world.entities.get(relation.targetId);
  if (!source || !target) return null;
  const spec = kindOf(source.kind)?.tether;
  const carried = kindOf(target.kind)?.carryable;
  if (!spec || !carried) return null;
  return {
    source,
    target,
    spec,
    from: tetherAnchor(source, spec.anchor),
    to: tetherAnchor(target, carried.anchor),
  };
}

export function heldBy(
  world: WorldState,
  targetId: string,
  sourceId = world.controlledId,
): boolean {
  return sourceId !== undefined && world.tethers.get(targetId)?.sourceId === sourceId;
}

/** Carry order belongs to the source's relations; entities remain in the shared index. */
export function carriedItems(world: WorldState, sourceId = world.controlledId): EntityState[] {
  const items: EntityState[] = [];
  for (const relation of world.tethers.values()) {
    if (relation.sourceId !== sourceId) continue;
    const item = world.entities.get(relation.targetId);
    if (item) items.push(item);
  }
  return items;
}

export function attachmentFailure(world: Relations, sourceId: string, targetId: string) {
  const source = world.entities.get(sourceId);
  const target = world.entities.get(targetId);
  if (!source || !target) return 'not-found';
  if (sourceId === targetId) return 'same-entity';
  const spec = kindOf(source.kind)?.tether;
  if (!spec) return 'not-tether-capable';
  if (!kindOf(target.kind)?.carryable) return 'not-carryable';
  if (world.tethers.has(targetId)) return 'already-tethered';
  let count = 0;
  for (const relation of world.tethers.values()) if (relation.sourceId === sourceId) count++;
  if (count >= spec.limit) return 'full';
  return null;
}

export function attachTether(world: WorldState, sourceId: string, targetId: string) {
  const reason = attachmentFailure(world, sourceId, targetId);
  if (reason) return { ok: false as const, reason };
  const relation: TetherRelation = { sourceId, targetId, length: 0 };
  const { spec, from, to } = tetherEndpoints(world, relation)!;
  const count = carriedItems(world, sourceId).length;
  relation.length = Math.max(
    spec.minLength + count * spec.spacing,
    Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z),
  );
  world.tethers.set(targetId, relation);
  recordWorldChange(world, { kind: 'tetherChanged', tether: relation, attached: true });
  return { ok: true as const, relation };
}

export function detachTether(world: WorldState, targetId: string, cause: ReleaseCause): boolean {
  const relation = world.tethers.get(targetId);
  if (!relation) return false;
  world.tethers.delete(targetId);
  recordWorldChange(world, { kind: 'tetherChanged', tether: relation, attached: false, cause });
  return true;
}

function velocityAt(entity: EntityState, point: Vec3): Vec3 {
  const yawRate = entity.control?.yawRate ?? 0;
  return {
    x: (entity.vx ?? 0) + yawRate * (point.z - entity.z),
    y: entity.vy ?? 0,
    z: (entity.vz ?? 0) - yawRate * (point.x - entity.x),
  };
}

/** Sum equal and opposite impulses before changing velocities, independent of relation order. */
export function pullTethers(world: WorldState, dt: number): Set<EntityState> {
  const impulses = new Map<EntityState, Vec3>();
  const add = (entity: EntityState, x: number, y: number, z: number) => {
    const physics = kindOf(entity.kind)?.physics;
    // Static and controlled endpoints are kinematic; loose endpoints receive the reaction too.
    if (!physics?.loose) return;
    const mass = Math.max(1e-9, physics.mass ?? sphereVolume(physics.radius));
    const sum = impulses.get(entity) ?? { x: 0, y: 0, z: 0 };
    sum.x += x / mass;
    sum.y += y / mass;
    sum.z += z / mass;
    impulses.set(entity, sum);
  };
  for (const relation of world.tethers.values()) {
    const ends = tetherEndpoints(world, relation);
    if (!ends) continue;
    const { source, target, from, to, spec } = ends;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= relation.length) continue;
    const nx = dx / distance;
    const ny = dy / distance;
    const nz = dz / distance;
    const a = velocityAt(source, from);
    const b = velocityAt(target, to);
    const separating = (b.x - a.x) * nx + (b.y - a.y) * ny + (b.z - a.z) * nz;
    const tension = spec.stiffness * (distance - relation.length) + spec.damping * separating;
    if (tension <= 0) continue;
    const impulse = tension * dt;
    add(source, nx * impulse, ny * impulse, nz * impulse);
    add(target, -nx * impulse, -ny * impulse, -nz * impulse);
  }
  for (const [entity, delta] of impulses) {
    entity.vx = (entity.vx ?? 0) + delta.x;
    entity.vy = (entity.vy ?? 0) + delta.y;
    entity.vz = (entity.vz ?? 0) + delta.z;
  }
  return new Set(impulses.keys());
}
