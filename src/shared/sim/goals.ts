import type { Spider } from './Spider.js';
import { IDLE_CONTROLS, type Controls } from '../../shared/types.js';
import type { PlanPoint } from '../route.js';

/**
 * A goal is a closed-loop controller: every fixed step it reads the body and
 * returns the inputs that move it toward a target, until done() or timeout.
 */
export interface Goal {
  readonly timeout: number;
  controls(): Controls;
  done(): boolean;
  /** Partial results, reported whether the goal finished or timed out. */
  result(): Record<string, unknown>;
}

/** How long a step may push against a wall or a slope before the goal gives up. */
export const STUCK_LIMIT = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapRadians(radians: number): number {
  const wrapped = ((((radians + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

function forwardOf(spider: Spider): { x: number; z: number } {
  return { x: -Math.sin(spider.yaw), z: -Math.cos(spider.yaw) };
}

/** Walk a signed distance along the current heading, decelerating into it. */
export function walkGoal(spider: Spider, distance: number, fast = false): Goal {
  const sign = Math.sign(distance) || 1;
  const start = { x: spider.root.position.x, z: spider.root.position.z };
  const forward = forwardOf(spider);
  const target = Math.abs(distance);

  const progress = () => {
    const dx = spider.root.position.x - start.x;
    const dz = spider.root.position.z - start.z;
    return (dx * forward.x + dz * forward.z) * sign;
  };

  return {
    timeout: Math.max(4, target / (fast ? 2.4 : 1.2) + 3),
    controls() {
      const remaining = target - progress();
      // Fast holds full throttle until the last stride, so the body actually reaches a run.
      const throttle = clamp(remaining / (fast ? 1.2 : 0.7), 0, 1) * sign;
      return { ...IDLE_CONTROLS, throttle, boost: fast ? 1 : 0 };
    },
    done() {
      if (spider.stuckFor >= STUCK_LIMIT) return true;
      return target - progress() <= 0.05 && Math.abs(spider.speed) < 0.2;
    },
    result() {
      const achieved = progress() * sign;
      if (spider.stuckFor < STUCK_LIMIT) return { target: distance, achieved };
      return { target: distance, achieved, halt: spider.halt };
    },
  };
}

/** Turn a signed number of degrees; positive is clockwise (the body's right). */
export function turnGoal(spider: Spider, degrees: number): Goal {
  const startYaw = spider.yaw;
  const targetYaw = startYaw - (degrees * Math.PI) / 180;
  const error = () => wrapRadians(targetYaw - spider.yaw);
  const turned = () => ((startYaw - spider.yaw) * 180) / Math.PI;

  return {
    timeout: Math.max(3, Math.abs(degrees) / 60 + 2),
    controls() {
      const u = -1.5 * (2.5 * error() + spider.yawRate);
      return { ...IDLE_CONTROLS, turn: clamp(u, -1, 1) };
    },
    done() {
      return Math.abs(error()) < 0.02 && Math.abs(spider.yawRate) < 0.08;
    },
    result() {
      return { target: degrees, achieved: turned() };
    },
  };
}

/** Meters still ahead of the current waypoint along the segment that reaches it. Negative once past. */
function segmentLeft(points: readonly PlanPoint[], index: number, place: PlanPoint): number {
  const point = points[Math.min(index, points.length - 1)];
  const prev = points[Math.max(0, index - 1)];
  const vx = point.x - prev.x;
  const vz = point.z - prev.z;
  const len = Math.hypot(vx, vz);
  if (len < 1e-6) return 0;
  const proj = ((place.x - prev.x) * vx + (place.z - prev.z) * vz) / len;
  return len - proj;
}

/**
 * Follow a path already planned around solids. This steers; it does not decide
 * where to go. Positive turn is clockwise, matching turnGoal.
 */
export function routeGoal(spider: Spider, points: readonly PlanPoint[], fast = false): Goal {
  let index = points.length > 1 ? 1 : 0;
  const length = points.reduce(
    (sum, point, i) =>
      i === 0 ? 0 : sum + Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z),
    0,
  );

  const here = () => ({ x: spider.root.position.x, z: spider.root.position.z });
  const waypoint = () => points[Math.min(index, points.length - 1)];
  const remainingTo = (point: PlanPoint) => Math.hypot(point.x - here().x, point.z - here().z);

  return {
    timeout: Math.max(8, length / (fast ? 2.2 : 1) + 4),
    controls() {
      const point = waypoint();
      const place = here();
      const dx = point.x - place.x;
      const dz = point.z - place.z;
      const clockwise = wrapRadians(Math.atan2(dx, -dz) + spider.yaw);
      const turn = clamp(-1.5 * (2.5 * -clockwise + spider.yawRate), -1, 1);
      const aligned = Math.abs(clockwise) < 0.55;
      const last = index >= points.length - 1;
      const left = segmentLeft(points, index, place);
      const distance = Math.hypot(dx, dz);
      // Close enough, and slow. Cutting the throttle here and then turning
      // back onto the point makes the last step pace past it.
      if (last && left < 0.2 && distance < 0.45 && Math.abs(spider.speed) < 0.45)
        return { ...IDLE_CONTROLS };
      const along = last ? Math.max(0, left) : distance;
      const throttle = aligned ? clamp(along / (fast ? 2.4 : 1.1), 0, 1) : 0;
      return { ...IDLE_CONTROLS, throttle, turn, boost: fast ? 1 : 0 };
    },
    done() {
      if (spider.stuckFor >= STUCK_LIMIT) return true;
      const point = waypoint();
      const distance = remainingTo(point);
      const last = index >= points.length - 1;
      if (!last && distance < 0.3) {
        index += 1;
        return false;
      }
      const left = segmentLeft(points, index, here());
      return (
        last &&
        distance < 0.45 &&
        left < 0.2 &&
        Math.abs(spider.speed) < 0.3 &&
        Math.abs(spider.yawRate) < 0.2
      );
    },
    result() {
      if (spider.stuckFor < STUCK_LIMIT) return {};
      return { halt: spider.halt };
    },
  };
}

/** Raise or lower the deck to a target height. */
export function heightGoal(spider: Spider, level: number): Goal {
  const target = clamp(level, -0.35, 0.7);
  return {
    timeout: 4,
    controls() {
      return { ...IDLE_CONTROLS, lift: Math.sign(target - spider.heightSet) };
    },
    done() {
      return Math.abs(spider.heightSet - target) < 0.01;
    },
    result() {
      return { target, achieved: spider.heightSet };
    },
  };
}
