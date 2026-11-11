import { BODY_RADIUS, moveCircle, type MotionSolver } from '@/src/shared/collision';
import { CONTACT } from '@/src/shared/config';
import { initialControl, type ControlSpec, type ControlState } from '@/src/shared/control';
import { kindOf } from '@/src/shared/kinds';
import type { ActorState, EntityState, Vec3 } from '@/src/shared/state';
import { WORLD_RADIUS } from '@/src/shared/terrain';
import { IDLE_CONTROLS, type Controls } from '@/src/shared/types';
import { floatHeight, WATER, waterPace, type Water } from '@/src/shared/water';
import type { ActorSpace } from '@/src/shared/sim/bindController';

const NO_WATER: Water = Object.freeze({ surface: Number.NEGATIVE_INFINITY, depth: 0 });
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** A registered movement capability. It never reads or writes a rendered object. */
export class Controller {
  entity!: EntityState;
  spec!: ControlSpec;
  motionSpace!: () => ActorSpace;
  #samples: Vec3[] = [];
  #ground: (x: number, z: number) => number = () => 0;
  #water: (x: number, z: number) => Water = () => NO_WATER;
  #mound: (x: number, z: number) => number = () => Number.NEGATIVE_INFINITY;
  #stepSupport: (x: number, z: number) => number = () => Number.NEGATIVE_INFINITY;
  #limit = WORLD_RADIUS;
  #turn: (from: number, to: number) => number = (_from, to) => to;
  #cache = { x: NaN, z: NaN, yaw: NaN, ground: 0 };
  #move: MotionSolver = (x, z, dx, dz) =>
    moveCircle(x, z, dx, dz, this.radius, {
      blocks: [],
      inside: (px, pz) => Math.hypot(px, pz) <= this.#limit,
      surface: (px, pz) => this.travel(px, pz),
      maxSlope: this.spec.maxSlope,
    });

  constructor(entity: EntityState) {
    this.bindEntity(entity);
  }

  bindEntity(entity: EntityState): void {
    const spec = kindOf(entity.kind)?.control;
    if (!spec) throw new Error(`Entity ${entity.id} has no registered movement capability`);
    this.entity = entity;
    this.spec = spec;
    entity.control ??= initialControl();
    this.#samples = spec.clearance.flatMap((shell) =>
      [-1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35].flatMap((phi) =>
        Array.from({ length: 12 }, (_, i) => {
          const theta = (i / 12) * Math.PI * 2;
          return {
            x: shell.c[0] + shell.r[0] * Math.cos(phi) * Math.cos(theta),
            y: shell.c[1] + shell.r[1] * Math.sin(phi),
            z: shell.c[2] + shell.r[2] * Math.cos(phi) * Math.sin(theta),
          };
        }),
      ),
    );
    this.#cache.x = NaN;
  }

  get state(): ControlState {
    return this.entity.control!;
  }
  get position(): Vec3 {
    return this.entity;
  }
  get yaw(): number {
    return this.state.yaw;
  }
  get yawRate(): number {
    return this.state.yawRate;
  }
  get lamp(): boolean {
    return this.state.lamp;
  }
  set lamp(value: boolean) {
    this.state.lamp = value;
  }
  get heightSet(): number {
    return this.state.height;
  }
  get speed(): number {
    return this.state.speed;
  }
  get time(): number {
    return this.state.time;
  }
  get stuckFor(): number {
    return this.state.stuckFor;
  }
  get halt(): 'clear' | 'solid' | 'steep' {
    return this.state.halt;
  }
  get radius(): number {
    return kindOf(this.entity.kind)?.physics?.radius ?? BODY_RADIUS;
  }
  get water(): Water {
    return this.#water(this.entity.x, this.entity.z);
  }
  get swimming(): boolean {
    const water = this.water;
    return water.depth > 0 && floatHeight(water) > this.#ground(this.entity.x, this.entity.z);
  }

  capture(): ActorState {
    return {
      time: this.time,
      position: { x: this.entity.x, y: this.entity.y, z: this.entity.z },
      yaw: this.yaw,
      speed: this.speed,
      height: this.heightSet,
      lamp: this.lamp,
    };
  }

  bindGround(ground: (x: number, z: number) => number, limit = WORLD_RADIUS): void {
    this.#ground = ground;
    this.#limit = limit;
    this.#cache.x = NaN;
  }
  bindMotion(move: MotionSolver): void {
    this.#move = move;
  }

  bindTurn(turn: (from: number, to: number) => number): void {
    this.#turn = turn;
  }
  bindWater(water: (x: number, z: number) => Water): void {
    this.#water = water;
  }
  bindSupport(mound: (x: number, z: number) => number): void {
    this.#mound = mound;
    this.#cache.x = NaN;
  }
  bindStepSupport(support: (x: number, z: number) => number): void {
    this.#stepSupport = support;
  }

  travel(x: number, z: number): number {
    const water = this.#water(x, z);
    const ground = this.#ground(x, z);
    return water.depth > 0 ? Math.max(ground, floatHeight(water)) : ground;
  }

  support(): number {
    const water = this.water;
    const float = water.depth > 0 ? floatHeight(water) : Number.NEGATIVE_INFINITY;
    return (
      Math.max(this.#clearance(), this.#stepSupport(this.entity.x, this.entity.z), float) +
      this.state.height
    );
  }

  update(dt: number, input: Controls = IDLE_CONTROLS): void {
    if (dt <= 0) return;
    const state = this.state;
    const spec = this.spec;
    const before = { x: this.entity.x, y: this.entity.y, z: this.entity.z };
    const throttle = input.throttle || 0;
    const turn = input.turn || 0;
    const lift = input.lift || 0;
    const water = this.water;
    state.time += dt;
    const yawTarget =
      turn * (input.boost ? spec.yawBoost : spec.yaw) * (water.depth > 0 ? WATER.turnPace : 1);
    state.yawRate += clamp(yawTarget - state.yawRate, -spec.yawAccel * dt, spec.yawAccel * dt);
    const previousYaw = state.yaw;
    const yaw = previousYaw - state.yawRate * dt;
    state.yaw = yaw === previousYaw ? yaw : this.#turn(previousYaw, yaw);
    const turnBlocked = Math.abs(state.yaw - yaw) > 1e-8;
    if (turnBlocked) state.yawRate = 0;
    state.halt = turnBlocked ? 'solid' : 'clear';
    const cruise = (input.boost ? spec.cruiseBoost : spec.cruise) * waterPace(water.depth);
    const ease = spec.speedEase + (water.depth > 0 ? WATER.spiderDrag : 0);
    state.speed += (throttle * cruise - state.speed) * (1 - Math.exp(-ease * dt));
    const dx = -Math.sin(state.yaw) * state.speed * dt;
    const dz = -Math.cos(state.yaw) * state.speed * dt;
    if (Math.hypot(dx, dz) >= 1e-6) {
      const moved = this.#move(before.x, before.z, dx, dz);
      this.entity.x = moved.x;
      this.entity.z = moved.z;
      if (moved.halt === 'steep' || Math.hypot(moved.x - before.x, moved.z - before.z) <= 1e-6) {
        state.speed = 0;
        if (moved.halt !== 'clear') state.halt = moved.halt;
      }
    }
    const moved = Math.hypot(this.entity.x - before.x, this.entity.z - before.z);
    const turningInPlace =
      turnBlocked && Math.abs(turn) > 0.05 && Math.abs(state.yaw - previousYaw) < 1e-6;
    state.stuckFor =
      (Math.abs(throttle) > 0.05 || turningInPlace) && state.halt !== 'clear' && moved < 1e-4
        ? state.stuckFor + dt
        : 0;
    state.height = clamp(state.height + lift * spec.liftRate * dt, spec.heightMin, spec.heightMax);
    this.#vertical(dt);
    this.#velocity(before, dt);
  }

  /** Adopt the shared contact solver's result before actions or rendering can observe it. */
  commit(
    reached: { x: number; z: number } | undefined,
    before: Vec3,
    stuckBefore: number,
    dt: number,
    input: Controls,
  ): void {
    if (!reached || Math.hypot(reached.x - this.entity.x, reached.z - this.entity.z) <= 1e-8)
      return;
    const proposed = Math.hypot(this.entity.x - before.x, this.entity.z - before.z);
    const actual = Math.hypot(reached.x - before.x, reached.z - before.z);
    this.entity.y = before.y + (this.entity.y - before.y) * (actual / proposed);
    this.entity.x = reached.x;
    this.entity.z = reached.z;
    this.state.speed = 0;
    this.state.halt = 'solid';
    this.state.stuckFor = Math.abs(input.throttle) > 0.05 && actual < 1e-4 ? stuckBefore + dt : 0;
    this.#velocity(before, dt);
  }

  #velocity(before: Vec3, dt: number): void {
    this.entity.vx = (this.entity.x - before.x) / dt;
    this.entity.vy = (this.entity.y - before.y) / dt;
    this.entity.vz = (this.entity.z - before.z) / dt;
  }

  #vertical(dt: number): void {
    const support = this.support();
    const state = this.state;
    const spec = this.spec;
    if (this.entity.y - support > spec.drop) {
      state.fall = Math.min(spec.fallMax, state.fall + spec.fallAccel * dt);
      this.entity.y = Math.max(support, this.entity.y - state.fall * dt);
      return;
    }
    state.fall = 0;
    const ease = this.swimming ? WATER.buoyancyEase : spec.liftEase;
    const follow = (support - this.entity.y) * Math.min(1, ease * dt);
    this.entity.y = Math.abs(follow) < 1e-4 ? support : this.entity.y + follow;
  }

  #clearance(): number {
    const { x, z } = this.entity;
    const yaw = this.state.yaw;
    const cache = this.#cache;
    if (x === cache.x && z === cache.z && yaw === cache.yaw) return cache.ground;
    const center = this.#ground(x, z);
    const cos = Math.cos(yaw),
      sin = Math.sin(yaw);
    const ahead = this.#ground(x - sin * 0.8, z - cos * 0.8) - center;
    const side = this.#ground(x + cos * 0.8, z - sin * 0.8) - center;
    const pitch = -clamp(ahead / 0.8, -0.35, 0.35);
    const roll = -clamp(side / 0.8, -0.25, 0.25);
    const cp = Math.cos(pitch),
      sp = Math.sin(pitch),
      cr = Math.cos(roll),
      sr = Math.sin(roll);
    let lift = 0;
    for (const point of this.#samples) {
      // Euler XYZ, with no local yaw: rotate about Z, then X, then world Y.
      const px = cr * point.x - sr * point.y;
      const py = sr * point.x + cr * point.y;
      const ry = cp * py - sp * point.z;
      const rz = sp * py + cp * point.z;
      const wx = x + px * cos + rz * sin;
      const wz = z - px * sin + rz * cos;
      lift = Math.max(lift, Math.max(this.#ground(wx, wz), this.#mound(wx, wz)) - center - ry);
    }
    cache.x = x;
    cache.z = z;
    cache.yaw = yaw;
    cache.ground = center + (lift > 0 ? lift + CONTACT : 0);
    return cache.ground;
  }
}
