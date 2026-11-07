export const NEST_SCALE_XZ = 1.35;
export const NEST_SCALE_Y = 1.15;
export const NEST_RO = 3.1;
export const NEST_RI = 1.4;
export const NEST_FLOOR = 0.16;
export const NEST_DOOR = -Math.PI / 2;
export const NEST_DOOR_HALF = 0.42;

export function nestWrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function back(angle: number): number {
  return 0.5 + 0.5 * Math.sin(angle);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function nestRimRadius(angle: number): number {
  return (
    1.98 +
    0.5 * Math.pow(back(angle), 1.4) +
    0.1 * Math.sin(3 * angle + 0.6) +
    0.05 * Math.sin(7 * angle + 2.1)
  );
}

function rimHeight(angle: number): number {
  return (
    0.4 +
    1.22 * Math.pow(back(angle), 1.5) +
    0.06 * Math.sin(2 * angle + 1.2) +
    0.035 * Math.sin(5 * angle + 0.3)
  );
}

export function nestDoor(angle: number): number {
  const delta = Math.abs(nestWrap(angle - NEST_DOOR));
  return smoothstep(NEST_DOOR_HALF + 0.16, NEST_DOOR_HALF - 0.03, delta);
}

export function nestLocalHeight(radius: number, angle: number): number {
  const rim = nestRimRadius(angle);
  const crest = rimHeight(angle);
  let y: number;
  if (radius <= NEST_RI) {
    y = NEST_FLOOR + 0.03 * (radius / NEST_RI) ** 2;
  } else if (radius <= rim) {
    const t = (radius - NEST_RI) / (rim - NEST_RI);
    y = NEST_FLOOR + (crest - NEST_FLOOR) * Math.pow(t, 1.3);
  } else {
    const t = (radius - rim) / (NEST_RO - rim);
    y = crest * Math.pow(1 - t, 1.2);
  }
  const open = nestDoor(angle) * smoothstep(1.02, 1.5, radius);
  return y * (1 - open) + (0.055 + 0.012 * (radius / NEST_RO)) * open;
}

export function nestSurface(
  origin: { x: number; y: number; z: number },
  x: number,
  z: number,
): number {
  const lx = (x - origin.x) / NEST_SCALE_XZ;
  const lz = (z - origin.z) / NEST_SCALE_XZ;
  const radius = Math.hypot(lx, lz);
  if (radius > NEST_RO + 1e-4) return Number.NEGATIVE_INFINITY;
  return origin.y + nestLocalHeight(radius, Math.atan2(lz, lx)) * NEST_SCALE_Y;
}
