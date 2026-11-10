import type { Vec3 } from './base';
import type { BodyState, Motion, Tether } from './module_Physics';

export interface AnchorMotion {
  /** 用牵引者的当前位姿，将局部挂点转换到世界坐标。 */
  readonly position: Vec3;
  /** 挂点在世界坐标下的速度，包含牵引者自身的运动。 */
  readonly velocity: Vec3;
}

/** 空间求解器将这份冲量纳入常规动态体求解。 */
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
