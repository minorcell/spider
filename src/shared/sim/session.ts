import {
  toHeading,
  toObservation,
  toSense,
  wrapDegrees,
  type EntityState,
  type Observation,
  type Sense,
  type SpiderState,
  type WorldState,
} from '../state.js';
import { kindOf, propertiesOf, slicesOf } from '../kinds.js';
import { IDLE_CONTROLS, type Controls } from '../types.js';
import { blockedAt, grassHere, insideHome, occluded } from '../sight.js';
import {
  createWorld,
  grow,
  GRASS_VIEW,
  nextPropId,
  REACH,
  REACH_Y,
  restingY,
  VIEW_DISTANCE,
} from '../world.js';
import { TERRAIN } from '../terrain.js';
import { CARRY_LIMIT } from '../config.js';
import { heightGoal, routeGoal, STUCK_LIMIT, turnGoal, walkGoal, type Goal } from './goals.js';
import { planRoute } from '../route.js';
import { applyBody, type SimBody } from './snapshot.js';
import { Spider } from './Spider.js';

/** A sentence for a detour the body already took. Null when the straight walk was clear. */
function detourNote(around: readonly string[], direct: boolean, arrived: boolean): string | null {
  if (direct && around.length === 0) return null;
  if (around.length > 0) {
    const list = around.join('、');
    return arrived ? `绕开了 ${list}，到了。` : `绕开了 ${list}，还是过不去。`;
  }
  return arrived ? '绕开了陡坡，到了。' : '试了旁边的路，还是过不去。';
}

export interface GoalOutcome {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}

interface ActiveGoal {
  goal: Goal;
  startedAt: number;
  guard: ReturnType<typeof setTimeout>;
  finish(outcome: GoalOutcome): void;
}

/**
 * Owns the simulation. The page ticks it locally; nothing else is authoritative.
 */
export class SimSession {
  readonly spider = new Spider();
  readonly world: WorldState;

  constructor(seed?: number) {
    this.world = createWorld(seed);
    this.spider.bindGround((x, z) => this.world.terrain.height(x, z), TERRAIN.half - 1);
    this.spider.bindBlocked((x, z) => blockedAt(x, z, this.world.blocks));
  }

  #active: ActiveGoal | null = null;

  /** Drop the goal that currently owns the body, if one is running. */
  cancel(): void {
    const active = this.#active;
    if (!active) return;
    active.finish({ ok: false, reason: 'cancelled', ...active.goal.result() });
  }

  snapshot(): { state: SpiderState; world: WorldState } {
    return { state: this.spider.capture(), world: this.world };
  }

  /** Load a saved island into this same world object. */
  adopt(body: SimBody): void {
    applyBody(this, body);
  }

  /**
   * Look. The distance cannot exceed the default, and grass shortens it further.
   * There is no way to see the whole island at once.
   */
  observe(distance = VIEW_DISTANCE): Observation {
    const asked = Math.min(VIEW_DISTANCE, Math.max(0, distance));
    const { x, z } = this.spider.root.position;
    const view = grassHere(x, z, this.world.entities) ? Math.min(asked, GRASS_VIEW) : asked;
    return toObservation(this.spider.capture(), this.world, REACH, view, REACH_Y);
  }

  /** Where the body is. `withWays` adds the 24-heading turn sentences. */
  sense(withWays = false): Sense {
    return toSense(this.spider.capture(), this.world, withWays);
  }

  /** One visible frame. The page calls this from its render loop. */
  frame(dt: number): void {
    this.#step(Math.min(0.05, Math.max(0, dt)));
  }

  /** Run a goal to completion; resolves on reach, timeout, or preemption. */
  run(goal: Goal): Promise<GoalOutcome> {
    const previous = this.#active;
    if (previous) previous.finish({ ok: false, reason: 'cancelled', ...previous.goal.result() });

    return new Promise<GoalOutcome>((resolve) => {
      const active: ActiveGoal = {
        goal,
        startedAt: this.spider.time,
        guard: undefined as unknown as ReturnType<typeof setTimeout>,
        finish: (outcome: GoalOutcome) => {
          /* v8 ignore next */
          if (this.#active === active) this.#active = null;
          clearTimeout(active.guard);
          resolve(outcome);
        },
      };
      // Wall-clock guard: if the sim is paused, sim time never reaches the
      // goal's timeout, and the tool call would otherwise hang forever.
      active.guard = setTimeout(
        () => active.finish({ ok: false, reason: 'timeout', ...goal.result() }),
        (goal.timeout + 3) * 1000,
      );
      this.#active = active;
    });
  }

  walk(distance: number, fast = false): Promise<GoalOutcome> {
    return this.run(walkGoal(this.spider, distance, fast));
  }

  turn(degrees: number): Promise<GoalOutcome> {
    return this.run(turnGoal(this.spider, degrees));
  }

  /** Turn to an absolute compass heading (0 = world -Z, clockwise positive). */
  turnTo(heading: number): Promise<GoalOutcome> {
    return this.turn(wrapDegrees(heading - toHeading(this.spider.yaw)));
  }

  setHeight(level: number): Promise<GoalOutcome> {
    return this.run(heightGoal(this.spider, level));
  }

  drive(seconds: number, input: Partial<Controls>): Promise<GoalOutcome> {
    const controls: Controls = {
      throttle: input.throttle ?? 0,
      turn: input.turn ?? 0,
      lift: input.lift ?? 0,
      boost: input.boost ?? 0,
    };
    const startedAt = this.spider.time;
    const held = () => Math.abs(controls.throttle) > 0.05 && this.spider.stuckFor >= STUCK_LIMIT;
    return this.run({
      timeout: seconds + 1,
      controls: () => controls,
      done: () => this.spider.time - startedAt >= seconds || held(),
      result: () => (held() ? { seconds, halt: this.spider.halt } : { seconds }),
    });
  }

  wait(seconds: number): Promise<GoalOutcome> {
    return this.drive(seconds, {});
  }

  /**
   * Go to a point. Solids and steep ground on the straight line are routed
   * around here; the caller does not steer the detour.
   */
  async moveTo(x: number, z: number, fast = false): Promise<GoalOutcome> {
    const limit = TERRAIN.half - 1;
    const blocks = this.world.blocks;
    const height = (px: number, pz: number) => this.world.terrain.height(px, pz);
    let direct = true;
    const around: string[] = [];
    let last: GoalOutcome = { ok: false, reason: 'no-path', detour: null };

    for (let attempt = 0; attempt < 3; attempt++) {
      const { x: x0, z: z0 } = this.spider.root.position;
      if (Math.hypot(x - x0, z - z0) <= 0.28) {
        return { ok: true, reason: 'reached', detour: detourNote(around, direct, true) };
      }
      const plan = planRoute(x0, z0, x, z, blocks, height, limit);
      if (!plan) return { ok: false, reason: 'no-path', detour: detourNote(around, direct, false) };
      direct = direct && plan.direct;
      for (const id of plan.around) if (!around.includes(id)) around.push(id);
      // Each attempt starts where the last one ended, so these stay sequential.
      // eslint-disable-next-line no-await-in-loop
      last = await this.run(routeGoal(this.spider, plan.points, fast));
      if (last.reason === 'cancelled') return { ...last, detour: null };
      if (last.ok) return { ok: true, reason: 'reached', detour: detourNote(around, direct, true) };
      if (last.reason !== 'blocked' && last.reason !== 'steep') return { ...last, detour: null };
    }
    return {
      ok: false,
      /* v8 ignore next */
      reason: last.reason ?? 'blocked',
      detour: detourNote(around, direct, false),
    };
  }

  /** Walk to within `standoff` of an entity, facing it. Detours stay inside moveTo. */
  async approach(id: string, standoff = REACH - 0.3, fast = false): Promise<GoalOutcome> {
    const entity = this.world.entities.find((item) => item.id === id);
    if (!entity) return { ok: false, reason: 'not-found', id, detour: null };

    const { x, z } = this.spider.root.position;
    if (Math.hypot(entity.x - x, entity.z - z) > standoff + 0.05) {
      const spot = this.#standOff(entity, standoff);
      if (!spot) return { ok: false, reason: 'no-path', id, detour: null };
      const moved = await this.moveTo(spot.x, spot.z, fast);
      if (!moved.ok) return { ...moved, id };
      const face = await this.#face(entity.x, entity.z);
      if (!face.ok) return { ...face, id, detour: moved.detour ?? null };
      return { ok: true, reason: 'reached', id, detour: moved.detour ?? null };
    }
    const face = await this.#face(entity.x, entity.z);
    if (!face.ok) return { ...face, id, detour: null };
    return { ok: true, reason: 'already-close', id, detour: null };
  }

  /** Eat something edible that is in reach, or one of the things on your back. */
  eat(id?: string): Promise<GoalOutcome> {
    const held = id ? this.world.carrying.find((item) => item.id === id) : undefined;
    let entity = held ?? this.#nearest(id, (item) => propertiesOf(item.kind).includes('edible'));
    if (!entity && !id)
      entity =
        this.world.carrying.find((item) => propertiesOf(item.kind).includes('edible')) ?? null;
    if (!entity)
      return Promise.resolve({ ok: false, reason: id ? 'not-found' : 'nothing-to-eat', id });
    if (!propertiesOf(entity.kind).includes('edible')) {
      return Promise.resolve({ ok: false, reason: 'not-edible', id: entity.id });
    }
    if (!this.world.carrying.includes(entity)) {
      const reach = this.#reachable(entity);
      if (!reach.ok) return Promise.resolve(reach);
    }

    const kind = kindOf(entity.kind);
    const meal = kind?.eat;
    if (!kind || !meal) return Promise.resolve({ ok: false, reason: 'not-edible', id: entity.id });

    const startedAt = this.spider.time;
    const slices = slicesOf(kind);
    const elapsed0 = slices === 0 ? 0 : (entity.stage * meal.duration) / slices;
    const remaining = Math.max(0.05, meal.duration - elapsed0);
    const sync = (): number => {
      const now = elapsed0 + (this.spider.time - startedAt);
      if (
        slices > 0 &&
        (this.world.entities.includes(entity) || this.world.carrying.includes(entity))
      ) {
        const visual = Math.min(meal.stages, Math.floor(now / (meal.duration / slices)));
        entity.stage = Math.max(entity.stage, visual);
      }
      return now;
    };

    return this.run({
      timeout: remaining + 1,
      controls: () => IDLE_CONTROLS,
      done: () => sync() >= meal.duration - 1e-4,
      result: () => ({ action: 'eat', target: entity.id, stage: entity.stage, removed: false }),
    }).then((outcome) => {
      if (!outcome.ok || !meal.removes) return { ...outcome, stage: entity.stage, removed: false };
      const stage = entity.stage;
      this.#remove(entity);
      return { ...outcome, action: 'eat', target: entity.id, stage, removed: true };
    });
  }

  /** Pick up one carryable thing, until the back is full. */
  pickUp(id?: string): Promise<GoalOutcome> {
    if (this.world.carrying.length >= CARRY_LIMIT) {
      return Promise.resolve({
        ok: false,
        reason: 'full',
        carrying: this.world.carrying.map((item) => item.id),
      });
    }
    const entity = this.#nearest(id, (item) => propertiesOf(item.kind).includes('carryable'));
    if (!entity)
      return Promise.resolve({ ok: false, reason: id ? 'not-found' : 'nothing-to-carry', id });
    if (!propertiesOf(entity.kind).includes('carryable')) {
      return Promise.resolve({ ok: false, reason: 'not-carryable', id: entity.id });
    }
    const reach = this.#reachable(entity);
    if (!reach.ok) return Promise.resolve(reach);

    const startedAt = this.spider.time;
    return this.run({
      timeout: 2,
      controls: () => IDLE_CONTROLS,
      done: () => this.spider.time - startedAt >= 0.7,
      result: () => ({ action: 'pick-up', target: entity.id }),
    }).then((outcome) => {
      if (!outcome.ok) return outcome;
      if (!this.world.entities.includes(entity))
        return { ok: false, reason: 'not-found', id: entity.id };
      this.#remove(entity);
      this.world.carrying.push(entity);
      return {
        ok: true,
        action: 'pick-up',
        target: entity.id,
        carrying: this.world.carrying.map((item) => item.id),
      };
    });
  }

  /** Put down one thing you are carrying. With no id, that is the last one you picked up. */
  drop(id?: string): GoalOutcome {
    const item = this.#carried(id);
    if (!item) return { ok: false, reason: 'not-carrying', id };
    const spot = this.#spotAhead();
    if (!spot) return { ok: false, reason: 'no-room', id: item.id };
    this.#putDown(item, spot.x, spot.z);
    return {
      ok: true,
      action: 'drop',
      target: item.id,
      x: item.x,
      z: item.z,
      carrying: this.world.carrying.map((held) => held.id),
    };
  }

  /** Leave one carried thing inside the nest. With no id, that is the last one you picked up. */
  store(id?: string): GoalOutcome {
    const item = this.#carried(id);
    if (!item) return { ok: false, reason: 'not-carrying', id };
    const { x, z } = this.spider.root.position;
    if (!insideHome(x, z)) return { ok: false, reason: 'not-home' };
    const spot = this.#stash();
    if (!spot) return { ok: false, reason: 'no-room' };
    this.#putDown(item, spot.x, spot.z);
    return {
      ok: true,
      action: 'store',
      target: item.id,
      x: item.x,
      z: item.z,
      carrying: this.world.carrying.map((held) => held.id),
    };
  }

  /** Sleep in the nest. You have to be home. */
  sleep(): Promise<GoalOutcome> {
    const { x, z } = this.spider.root.position;
    if (!insideHome(x, z)) return Promise.resolve({ ok: false, reason: 'not-home' });
    const duration = 4;
    const startedAt = this.spider.time;
    const woke = this.spider.heightSet;
    return this.run({
      timeout: duration + 2,
      controls: () => {
        const elapsed = this.spider.time - startedAt;
        const target = elapsed < duration * 0.75 ? -0.28 : woke;
        const lift =
          Math.abs(this.spider.heightSet - target) < 0.02
            ? 0
            : Math.sign(target - this.spider.heightSet);
        return { ...IDLE_CONTROLS, lift };
      },
      done: () =>
        this.spider.time - startedAt >= duration && Math.abs(this.spider.heightSet - woke) < 0.05,
      result: () => ({ action: 'sleep', home: true }),
    });
  }

  /** Drop a new prop into the world, sitting on the ground. */
  addEntity(kind: string, x: number, z: number): WorldState['entities'][number] {
    const entity = {
      id: nextPropId(this.world, kind),
      kind,
      x,
      y: restingY(this.world.terrain, kind, x, z),
      z,
      stage: 0,
    };
    this.world.entities.push(entity);
    return entity;
  }

  #face(x: number, z: number): Promise<GoalOutcome> {
    const bearing =
      (Math.atan2(x - this.spider.root.position.x, -(z - this.spider.root.position.z)) * 180) /
      Math.PI;
    return this.turn(wrapDegrees(bearing - toHeading(this.spider.yaw)));
  }

  /** A free place at `standoff` from the entity, preferring the near side, that a route can reach. */
  #standOff(entity: EntityState, standoff: number): { x: number; z: number } | null {
    const sx = this.spider.root.position.x;
    const sz = this.spider.root.position.z;
    const blocks = this.world.blocks;
    const limit = TERRAIN.half - 1;
    const height = (px: number, pz: number) => this.world.terrain.height(px, pz);
    const spots: { x: number; z: number; rank: number }[] = [];
    const dx = entity.x - sx;
    const dz = entity.z - sz;
    const dist = Math.hypot(dx, dz);
    /* v8 ignore next */
    if (dist > 1e-3) {
      const travel = Math.max(0, dist - standoff);
      const x = sx + (dx / dist) * travel;
      const z = sz + (dz / dist) * travel;
      if (!blockedAt(x, z, blocks)) spots.push({ x, z, rank: 0 });
    }
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const x = entity.x + Math.cos(angle) * standoff;
      const z = entity.z + Math.sin(angle) * standoff;
      if (blockedAt(x, z, blocks)) continue;
      spots.push({ x, z, rank: Math.hypot(x - sx, z - sz) });
    }
    spots.sort((a, b) => a.rank - b.rank);
    for (const spot of spots) {
      if (planRoute(sx, sz, spot.x, spot.z, blocks, height, limit)) return spot;
    }
    return null;
  }

  #nearest(id: string | undefined, want: (entity: EntityState) => boolean): EntityState | null {
    const { x, z } = this.spider.root.position;
    const pool = this.world.entities.filter((item) => (id ? item.id === id : want(item)));
    if (pool.length === 0) return null;
    return pool.reduce((best, item) =>
      Math.hypot(item.x - x, item.z - z) < Math.hypot(best.x - x, best.z - z) ? item : best,
    );
  }

  #reachable(entity: EntityState): GoalOutcome {
    const { x, y, z } = this.spider.root.position;
    const distance = Math.hypot(entity.x - x, entity.z - z);
    const vertical = Math.abs(entity.y - y);
    if (distance > REACH || vertical > REACH_Y) {
      return { ok: false, reason: 'out-of-reach', id: entity.id, distance };
    }
    const eye = this.world.terrain.height(x, z) + 0.85;
    if (occluded(x, z, entity.x, entity.z, this.world.blocks, entity.id, eye)) {
      return { ok: false, reason: 'blocked', id: entity.id };
    }
    return { ok: true };
  }

  /** The named thing on your back, or the last one picked up when id is omitted. */
  #carried(id?: string): EntityState | null {
    if (id) return this.world.carrying.find((item) => item.id === id) ?? null;
    return this.world.carrying[this.world.carrying.length - 1] ?? null;
  }

  #spotAhead(): { x: number; z: number } | null {
    const { x, z } = this.spider.root.position;
    const forward = { x: -Math.sin(this.spider.yaw), z: -Math.cos(this.spider.yaw) };
    const right = { x: -forward.z, z: forward.x };
    const spots = [
      { x: x + forward.x * 0.85, z: z + forward.z * 0.85 },
      { x, z },
    ];
    for (let step = 1; step <= 3; step++) {
      for (const side of [-1, 1]) {
        spots.push({
          x: x + forward.x * 0.85 + right.x * side * step * 0.45,
          z: z + forward.z * 0.85 + right.z * side * step * 0.45,
        });
      }
    }
    return spots.find((spot) => this.#roomAt(spot.x, spot.z)) ?? null;
  }

  #roomAt(x: number, z: number): boolean {
    if (blockedAt(x, z, this.world.blocks, 0.2)) return false;
    return this.world.entities.every((item) => Math.hypot(item.x - x, item.z - z) > 0.4);
  }

  #stash(): { x: number; z: number } | null {
    for (let slot = 0; slot < 8; slot++) {
      const x = 1.15;
      const z = 1.15 - slot * 0.45;
      /* v8 ignore next */
      if (!insideHome(x, z)) break;
      if (this.#roomAt(x, z)) return { x, z };
    }
    return null;
  }

  #putDown(item: EntityState, x: number, z: number): void {
    item.x = x;
    item.z = z;
    item.y = restingY(this.world.terrain, item.kind, x, z, item.footprint);
    const carried = this.world.carrying.indexOf(item);
    /* v8 ignore next */
    if (carried >= 0) this.world.carrying.splice(carried, 1);
    this.world.entities.push(item);
  }

  #remove(entity: EntityState): void {
    const carried = this.world.carrying.indexOf(entity);
    if (carried >= 0) {
      this.world.carrying.splice(carried, 1);
      return;
    }
    const index = this.world.entities.indexOf(entity);
    if (index >= 0) this.world.entities.splice(index, 1);
  }

  #step(dt: number): void {
    grow(this.world, dt, { x: this.spider.root.position.x, z: this.spider.root.position.z });

    const active = this.#active;
    this.spider.update(dt, active ? active.goal.controls() : IDLE_CONTROLS);
    if (!active) return;

    const reached = active.goal.done();
    const overtime = this.spider.time - active.startedAt > active.goal.timeout;
    if (!reached && !overtime) return;

    const detail = active.goal.result();
    const halt = detail.halt;
    const stopped = halt === 'solid' || halt === 'steep';
    active.finish({
      ok: reached && !stopped,
      reason: stopped ? (halt === 'steep' ? 'steep' : 'blocked') : reached ? 'reached' : 'timeout',
      ...detail,
    });
  }
}
