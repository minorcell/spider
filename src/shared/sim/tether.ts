import type { EntityState, Vec3, WorldState } from '@/src/shared/state';

export const MIN_TETHER_LENGTH = 1.2;

export interface TetherMotion {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export function tetherAnchor(position: Vec3, yaw: number): Vec3 {
  return {
    x: position.x + Math.sin(yaw) * 1.66,
    y: position.y + 0.82,
    z: position.z + Math.cos(yaw) * 1.66,
  };
}

export function tetherLength(anchor: Vec3, item: EntityState, index: number): number {
  return Math.max(
    MIN_TETHER_LENGTH + index * 0.45,
    Math.hypot(item.x - anchor.x, item.y - anchor.y, item.z - anchor.z),
  );
}

/** The carry order belongs to the relation, while the entity stays in the world. */
export function carriedItems(world: WorldState): EntityState[] {
  const items: EntityState[] = [];
  for (const id of world.tethers.keys()) {
    const item = world.entities.find((entity) => entity.id === id);
    if (item) items.push(item);
  }
  return items;
}

/** Feed spring tension into the same velocity that contact, gravity and buoyancy solve. */
export function pullTether(
  item: EntityState,
  rest: number,
  anchor: TetherMotion,
  mass: number,
  dt: number,
): boolean {
  const dx = item.x - anchor.position.x;
  const dy = item.y - anchor.position.y;
  const dz = item.z - anchor.position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= rest) return false;
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const vx = item.vx ?? 0;
  const vy = item.vy ?? 0;
  const vz = item.vz ?? 0;
  const separating =
    (vx - anchor.velocity.x) * nx + (vy - anchor.velocity.y) * ny + (vz - anchor.velocity.z) * nz;
  const tension = 0.65 * (distance - rest) + 0.11 * separating;
  if (tension <= 0) return false;
  const change = (tension * dt) / mass;
  item.vx = vx - nx * change;
  item.vy = vy - ny * change;
  item.vz = vz - nz * change;
  return true;
}
