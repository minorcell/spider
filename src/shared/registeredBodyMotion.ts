import {
  BODY_RADIUS,
  moveCircle,
  sweepCircle,
  type MotionResult,
  type MotionSpace,
} from '@/src/shared/collision';
import type { ControlSpec } from '@/src/shared/control';
import type { Block, Vec3 } from '@/src/shared/state';

export function registeredFootprint(clearance: ControlSpec['clearance'], radius: number) {
  let width = radius;
  let turnRadius = radius;
  for (const { c, r } of clearance) {
    const partRadius = Math.max(r[0], r[2]);
    width = Math.max(width, Math.abs(c[0]) + partRadius);
    turnRadius = Math.max(turnRadius, Math.hypot(c[0], c[2]) + partRadius);
  }
  return { radius: width, turnRadius };
}

function probes(body: Vec3, yaw: number, clearance: ControlSpec['clearance'], radius: number) {
  if (clearance.length === 0) return [{ x: body.x, z: body.z, bottom: body.y, radius }];
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return clearance.map((part) => ({
    x: body.x + part.c[0] * c + part.c[2] * s,
    z: body.z - part.c[0] * s + part.c[2] * c,
    bottom: body.y + part.c[1] - part.r[1],
    radius: Math.max(part.r[0], part.r[2]),
  }));
}

/** Every registered section participates; the actor's origin is not its whole body. */
export function moveRegisteredBody(
  body: Vec3,
  yaw: number,
  clearance: ControlSpec['clearance'],
  dx: number,
  dz: number,
  space: MotionSpace & { insideRadius?: (x: number, z: number, radius: number) => boolean },
  radius = BODY_RADIUS,
): MotionResult {
  let halt: MotionResult['halt'] = 'clear';
  const parts = probes(body, yaw, clearance, radius).map((part) => ({
    ...part,
    space: {
      ...space,
      blocks: space.blocks.filter((block) => block.height > part.bottom),
      inside: space.insideRadius
        ? (x: number, z: number) => space.insideRadius!(x, z, part.radius)
        : space.inside,
    },
  }));
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const part of parts) {
      const reached = moveCircle(part.x, part.z, dx, dz, part.radius, part.space);
      const nx = reached.x - part.x,
        nz = reached.z - part.z;
      if (Math.hypot(nx - dx, nz - dz) > 1e-8) changed = true;
      if (reached.halt !== 'clear') halt = reached.halt;
      dx = nx;
      dz = nz;
    }
    if (!changed) break;
  }
  return { x: body.x + dx, z: body.z + dz, dx, dz, halt };
}

/** Turning sweeps the same footprint instead of rotating the abdomen through a wall. */
export function turnRegisteredBody(
  body: Vec3,
  from: number,
  to: number,
  clearance: ControlSpec['clearance'],
  blocks: readonly Block[],
  radius = BODY_RADIUS,
): number {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / 0.025));
  let previous = probes(body, from, clearance, radius);
  const solids = previous.map(({ bottom }) => blocks.filter((block) => block.height > bottom));
  let last = from;
  for (let i = 1; i <= steps; i++) {
    const yaw = from + ((to - from) * i) / steps;
    const next = probes(body, yaw, clearance, radius);
    if (
      previous.some((part, index) =>
        sweepCircle(
          part.x,
          part.z,
          next[index].x - part.x,
          next[index].z - part.z,
          part.radius,
          solids[index],
        ),
      )
    )
      return last;
    previous = next;
    last = yaw;
  }
  return to;
}
