import type { ControlSpec } from '@/src/shared/control';
import type { Vec3 } from '@/src/shared/state';

export interface MotionActor {
  readonly spec: Pick<ControlSpec, 'heightMin' | 'heightMax'>;
  readonly position: Vec3;
  yaw: number;
  yawRate: number;
  speed: number;
  heightSet: number;
  stuckFor: number;
  halt: 'clear' | 'solid' | 'steep';
}
import { IDLE_CONTROLS, type Controls } from '@/src/shared/types';
import type { PlanPoint } from '@/src/shared/route';

export interface GoalOutcome {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface Goal {
  readonly targets?: readonly string[];
  readonly timeout: number;
  controls(): Controls;
  done(): boolean;
  result(): Record<string, unknown>;
  commit?(): GoalOutcome;
  cleanup?(): void;
}

export const STUCK_LIMIT = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapRadians(radians: number): number {
  const wrapped = ((((radians + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

function forwardOf(spider: MotionActor): { x: number; z: number } {
  return { x: -Math.sin(spider.yaw), z: -Math.cos(spider.yaw) };
}

export function walkGoal(spider: MotionActor, distance: number, fast = false): Goal {
  const sign = Math.sign(distance) || 1;
  const start = { x: spider.position.x, z: spider.position.z };
  const forward = forwardOf(spider);
  const target = Math.abs(distance);

  const progress = () => {
    const dx = spider.position.x - start.x;
    const dz = spider.position.z - start.z;
    return (dx * forward.x + dz * forward.z) * sign;
  };

  return {
    timeout: Math.max(4, target / (fast ? 2.4 : 1.2) + 3),
    controls() {
      const remaining = target - progress();
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

export function turnGoal(spider: MotionActor, degrees: number): Goal {
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
      return (
        spider.stuckFor >= STUCK_LIMIT ||
        (Math.abs(error()) < 0.02 && Math.abs(spider.yawRate) < 0.08)
      );
    },
    result() {
      return spider.stuckFor >= STUCK_LIMIT
        ? { target: degrees, achieved: turned(), halt: spider.halt }
        : { target: degrees, achieved: turned() };
    },
  };
}

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

export function routeGoal(spider: MotionActor, points: readonly PlanPoint[], fast = false): Goal {
  let index = points.length > 1 ? 1 : 0;
  let escapes = 0;
  let escapeFrom: PlanPoint | null = null;
  const length = points.reduce(
    (sum, point, i) =>
      i === 0 ? 0 : sum + Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z),
    0,
  );

  const here = () => ({ x: spider.position.x, z: spider.position.z });
  const waypoint = () => points[Math.min(index, points.length - 1)];
  const remainingTo = (point: PlanPoint) => Math.hypot(point.x - here().x, point.z - here().z);
  const bearingError = (point: PlanPoint, place: PlanPoint) =>
    wrapRadians(Math.atan2(point.x - place.x, place.z - point.z) + spider.yaw);

  return {
    timeout: Math.max(8, length / (fast ? 2.2 : 1) + 4),
    controls() {
      if (escapeFrom) return { ...IDLE_CONTROLS, throttle: escapes === 1 ? 0.65 : -0.65 };
      const point = waypoint();
      const place = here();
      const dx = point.x - place.x;
      const dz = point.z - place.z;
      const clockwise = bearingError(point, place);
      const turn = clamp(-1.5 * (2.5 * -clockwise + spider.yawRate), -1, 1);
      const aligned = Math.abs(clockwise) < 0.55;
      const last = index >= points.length - 1;
      const left = segmentLeft(points, index, place);
      const distance = Math.hypot(dx, dz);
      if (last && left < 0.2 && distance < 0.45 && Math.abs(spider.speed) < 0.45)
        return { ...IDLE_CONTROLS };
      const along = last ? Math.max(0, left) : distance;
      const throttle = aligned ? clamp(along / (fast ? 2.4 : 1.1), 0, 1) : 0;
      return { ...IDLE_CONTROLS, throttle, turn, boost: fast ? 1 : 0 };
    },
    done() {
      const point = waypoint();
      const stalled = spider.stuckFor >= STUCK_LIMIT;
      if (escapeFrom && remainingTo(escapeFrom) >= 1) {
        escapeFrom = null;
        return false;
      }
      if (stalled && escapes < 2 && (escapeFrom || Math.abs(bearingError(point, here())) >= 0.55)) {
        escapes += 1;
        escapeFrom = here();
        return false;
      }
      if (stalled) return true;
      if (escapeFrom) return false;
      const distance = remainingTo(point);
      const last = index >= points.length - 1;
      if (!last && distance < 0.3) {
        index += 1;
        escapes = 0;
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

export function heightGoal(spider: MotionActor, level: number): Goal {
  const target = clamp(level, spider.spec.heightMin, spider.spec.heightMax);
  return {
    timeout: 6,
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
