import type { Vec3 } from './base';
import type { BodyState, Motion, Tether } from './module_Physics';

export interface AnchorMotion {
  /** Local mount transformed through the carrier's current pose. */
  readonly position: Vec3;
  /** World-space mount velocity, including carrier motion. */
  readonly velocity: Vec3;
}

/** The space supplies this impulse to its normal dynamic-body solve. */
export function tetherImpulse(
  tether: Tether,
  anchor: AnchorMotion,
  target: BodyState,
  dtSeconds: number,
): Motion | undefined {
  const position = target.pose.position;
  const dx = position.x - anchor.position.x;
  const dy = position.y - anchor.position.y;
  const dz = position.z - anchor.position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= tether.restLength || distance === 0) return undefined;

  const direction = { x: dx / distance, y: dy / distance, z: dz / distance };
  const separatingSpeed =
    (target.velocity.x - anchor.velocity.x) * direction.x +
    (target.velocity.y - anchor.velocity.y) * direction.y +
    (target.velocity.z - anchor.velocity.z) * direction.z;
  const extension = distance - tether.restLength;
  const tension = Math.max(0, tether.stiffness * extension + tether.damping * separatingSpeed);
  const impulse = -tension * dtSeconds;
  return {
    kind: 'impulse',
    entity: tether.target,
    impulse: { x: direction.x * impulse, y: direction.y * impulse, z: direction.z * impulse },
  };
}
