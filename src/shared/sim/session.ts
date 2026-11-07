import {
  toHeading,
  toNear,
  toObservation,
  toSense,
  wrapDegrees,
  type EntityState,
  type NearEntity,
  type Observation,
  type PlaceMark,
  type Sense,
  type SpiderState,
  type WorldInfo,
  type WorldState,
} from '../state.js';
import { kindOf, propertiesOf, slicesOf } from '../kinds.js';
import { IDLE_CONTROLS } from '../types.js';
import {
  blockedAt,
  BODY_RADIUS,
  EYE_HEIGHT,
  grassHere,
  groundOccluded,
  insideHome,
  occluded,
  SIGHT_TOP,
} from '../sight.js';
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
import { insideLand, nearestWater, surfaceOf, Terrain, WORLD_RADIUS } from '../terrain.js';
import { CARRY_LIMIT, MARK_LIMIT, MARK_NAME_MAX, MARK_NOTE_MAX } from '../config.js';
import { waterAt } from '../water.js';
import { heightGoal, routeGoal, turnGoal, walkGoal, type Goal } from './goals.js';
import { planRoute } from '../route.js';
import { applyBody, type SimBody } from './snapshot.js';
import { bindLegWorld } from './bindWorld.js';
import { stepPhysics } from './physics.js';
import { Spider } from './Spider.js';
import { localDate } from '../dates.js';
import { visualRange, worldClock } from '../ecology.js';

function detourNote(around: readonly string[], direct: boolean, arrived: boolean): string | null {
  if (direct && around.length === 0) return null;
  if (around.length > 0) {
    const list = around.join('、');
    return arrived ? `绕开了 ${list}，到了。` : `绕开了 ${list}，还是过不去。`;
  }
  return arrived ? '绕开了陡坡，到了。' : '试了旁边的路，还是过不去。';
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface GoalOutcome {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface MarkView extends PlaceMark {
  distance: number;
  bearing: number;
}

interface ActiveGoal {
  goal: Goal;
  startedAt: number;
  guard: ReturnType<typeof setTimeout>;
  finish(outcome: GoalOutcome): void;
}

export class SimSession {
  readonly spider = new Spider();
  readonly world: WorldState;

  constructor(seed?: number, terrain?: Terrain) {
    this.world = terrain ? createWorld(terrain.seed, terrain) : createWorld(seed);
    bindLegWorld(this.spider, this.world);
    this.spider.bindGround((x, z) => this.world.terrain.height(x, z));
    this.spider.bindWater((x, z) => waterAt(this.world.terrain, x, z));
    this.spider.bindBlocked(
      (x, z) =>
        blockedAt(x, z, this.world.blocks) || !insideLand(this.world.terrain, x, z, BODY_RADIUS),
    );
  }

  #active: ActiveGoal | null = null;

  cancel(): void {
    const active = this.#active;
    if (!active) return;
    active.finish({ ok: false, reason: 'cancelled', ...active.goal.result() });
  }

  snapshot(): { state: SpiderState; world: WorldState } {
    return { state: this.spider.capture(), world: this.world };
  }

  worldInfo(now = new Date()): WorldInfo {
    const clock = worldClock(now);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return {
      clock: {
        localDate: localDate(now),
        localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
        phase: clock.period,
        daylight: round3(clock.daylight),
      },
      lamp: this.spider.lamp,
      view: round3(visualRange(clock, this.spider.lamp)),
    };
  }

  get lamp(): boolean {
    return this.spider.lamp;
  }

  setLamp(on: boolean): void {
    this.spider.lamp = on;
  }

  adopt(body: SimBody): void {
    applyBody(this, body);
  }

  observe(distance = VIEW_DISTANCE): Observation {
    const asked = Math.min(VIEW_DISTANCE, Math.max(0, distance));
    const light = worldClock();
    const lightLimit = VIEW_DISTANCE * visualRange(light, this.spider.lamp);
    const { x, z } = this.spider.root.position;
    const ground = surfaceOf(this.world.terrain, x, z);
    const eye = ground + EYE_HEIGHT + this.spider.heightSet;
    const view = grassHere(x, z, this.world.entities, eye)
      ? Math.min(asked, GRASS_VIEW, lightLimit)
      : Math.min(asked, lightLimit);
    return toObservation(this.spider.capture(), this.world, REACH, view, REACH_Y);
  }

  sense(withWays = false): Sense {
    return toSense(this.spider.capture(), this.world, withWays);
  }

  near(): NearEntity[] {
    return toNear(this.spider.capture(), this.world, REACH, REACH_Y);
  }

  mark(name: string, note?: string): GoalOutcome {
    const clean = name.trim();
    if (clean.length === 0) return { ok: false, reason: 'need-name' };
    if (clean.length > MARK_NAME_MAX) return { ok: false, reason: 'name-too-long' };
    const line = note?.trim();
    if (line && line.length > MARK_NOTE_MAX) return { ok: false, reason: 'note-too-long' };
    if (this.world.marks.some((mark) => mark.name === clean)) {
      return { ok: false, reason: 'name-taken', name: clean };
    }
    if (this.world.marks.length >= MARK_LIMIT) return { ok: false, reason: 'full' };
    const { x, z } = this.spider.root.position;
    const mark: PlaceMark = { name: clean, x: round3(x), z: round3(z) };
    if (line) mark.note = line;
    this.world.marks.push(mark);
    return {
      ok: true,
      action: 'mark',
      name: mark.name,
      x: mark.x,
      z: mark.z,
      ...(line ? { note: line } : {}),
    };
  }

  marks(): MarkView[] {
    const { x, z } = this.spider.root.position;
    const heading = toHeading(this.spider.yaw);
    return this.world.marks
      .map((mark) => {
        const dx = mark.x - x;
        const dz = mark.z - z;
        return {
          ...mark,
          distance: round3(Math.hypot(dx, dz)),
          bearing:
            dx === 0 && dz === 0
              ? 0
              : Math.round(wrapDegrees((Math.atan2(dx, -dz) * 180) / Math.PI - heading) * 10) / 10,
        };
      })
      .toSorted((a, b) => a.distance - b.distance);
  }

  forgetMark(name: string): GoalOutcome {
    const clean = name.trim();
    if (clean.length === 0) return { ok: false, reason: 'need-name' };
    const index = this.world.marks.findIndex((mark) => mark.name === clean);
    if (index === -1) return { ok: false, reason: 'not-found', name: clean };
    this.world.marks.splice(index, 1);
    return { ok: true, action: 'forget', name: clean };
  }

  async goToMark(name: string, fast = false): Promise<GoalOutcome> {
    const clean = name.trim();
    if (clean.length === 0) return { ok: false, reason: 'need-name' };
    const mark = this.world.marks.find((item) => item.name === clean);
    if (!mark) return { ok: false, reason: 'not-found', name: clean };
    return { ...(await this.moveTo(mark.x, mark.z, fast)), name: clean };
  }

  frame(dt: number): void {
    this.#step(Math.min(0.05, Math.max(0, dt)));
  }

  run(goal: Goal): Promise<GoalOutcome> {
    const previous = this.#active;
    if (previous) previous.finish({ ok: false, reason: 'cancelled', ...previous.goal.result() });

    return new Promise<GoalOutcome>((resolve) => {
      const active: ActiveGoal = {
        goal,
        startedAt: this.spider.time,
        guard: undefined as unknown as ReturnType<typeof setTimeout>,
        finish: (outcome: GoalOutcome) => {
          if (this.#active === active) this.#active = null;
          clearTimeout(active.guard);
          resolve(outcome);
        },
      };
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

  turnTo(heading: number): Promise<GoalOutcome> {
    return this.turn(wrapDegrees(heading - toHeading(this.spider.yaw)));
  }

  setHeight(level: number): Promise<GoalOutcome> {
    return this.run(heightGoal(this.spider, level));
  }

  async moveTo(x: number, z: number, fast = false): Promise<GoalOutcome> {
    const limit = WORLD_RADIUS;
    const blocks = this.world.blocks;
    const height = (px: number, pz: number) => surfaceOf(this.world.terrain, px, pz);
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
      last = await this.run(routeGoal(this.spider, plan.points, fast));
      if (last.reason === 'cancelled') return { ...last, detour: null };
      if (last.ok) return { ok: true, reason: 'reached', detour: detourNote(around, direct, true) };
      if (last.reason !== 'blocked' && last.reason !== 'steep') return { ...last, detour: null };
    }
    return {
      ok: false,
      reason: last.reason,
      detour: detourNote(around, direct, false),
    };
  }

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
    this.spider.setInteraction(entity, 'reach');
    return this.run({
      timeout: 3,
      controls: () => {
        const elapsed = this.spider.time - startedAt;
        if (elapsed < 0.35) {
          this.spider.setInteraction(entity, 'reach');
          return IDLE_CONTROLS;
        }
        // 拖拽时蜘蛛背向目标施力，果子始终留在地面上，跟在腹部后方。
        const yaw = this.spider.yaw;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        entity.x = this.spider.root.position.x - fx * 0.62;
        entity.z = this.spider.root.position.z - fz * 0.62;
        entity.y = restingY(this.world.terrain, entity.kind, entity.x, entity.z, entity.footprint);
        this.spider.setInteraction(entity, 'drag');
        return { ...IDLE_CONTROLS, throttle: -0.28 };
      },
      done: () => this.spider.time - startedAt >= 1.45,
      result: () => ({ action: 'pick-up', target: entity.id }),
    }).then((outcome) => {
      this.spider.setInteraction(null);
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

  drink(): GoalOutcome {
    const { x, z } = this.spider.root.position;
    const spot = nearestWater(this.world.terrain, x, z, REACH);
    if (!spot) return { ok: false, reason: 'no-water' };
    return {
      ok: true,
      action: 'drink',
      x: Math.round(spot.x * 1000) / 1000,
      z: Math.round(spot.z * 1000) / 1000,
      distance: Math.round(spot.distance * 1000) / 1000,
    };
  }

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

  #standOff(entity: EntityState, standoff: number): { x: number; z: number } | null {
    const sx = this.spider.root.position.x;
    const sz = this.spider.root.position.z;
    const blocks = this.world.blocks;
    const limit = WORLD_RADIUS;
    const height = (px: number, pz: number) => surfaceOf(this.world.terrain, px, pz);
    const spots: { x: number; z: number; rank: number }[] = [];
    const dx = entity.x - sx;
    const dz = entity.z - sz;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-3) {
      const travel = Math.max(0, dist - standoff);
      const x = sx + (dx / dist) * travel;
      const z = sz + (dz / dist) * travel;
      if (!blockedAt(x, z, blocks) && insideLand(this.world.terrain, x, z, BODY_RADIUS)) {
        spots.push({ x, z, rank: 0 });
      }
    }
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const x = entity.x + Math.cos(angle) * standoff;
      const z = entity.z + Math.sin(angle) * standoff;
      if (blockedAt(x, z, blocks) || !insideLand(this.world.terrain, x, z, BODY_RADIUS)) continue;
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
    const eye = surfaceOf(this.world.terrain, x, z) + EYE_HEIGHT + this.spider.heightSet;
    if (occluded(x, z, entity.x, entity.z, this.world.blocks, entity.id, eye)) {
      return { ok: false, reason: 'blocked', id: entity.id };
    }
    if (
      groundOccluded(x, z, eye, entity.x, entity.y + SIGHT_TOP, entity.z, (hx, hz) =>
        this.world.terrain.height(hx, hz),
      )
    ) {
      return { ok: false, reason: 'blocked', id: entity.id };
    }
    return { ok: true };
  }

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
    if (!insideLand(this.world.terrain, x, z, BODY_RADIUS)) return false;
    return this.world.entities.every((item) => Math.hypot(item.x - x, item.z - z) > 0.4);
  }

  #stash(): { x: number; z: number } | null {
    const step = 0.45;
    const start = 1.15;
    for (let column = 0; ; column += 1) {
      const x = start - column * step;
      if (!insideHome(x, 0)) break;
      for (let row = 0; ; row += 1) {
        const z = start - row * step;
        if (!insideHome(x, z)) break;
        if (this.#roomAt(x, z)) return { x, z };
      }
    }
    return null;
  }

  #putDown(item: EntityState, x: number, z: number): void {
    item.x = x;
    item.z = z;
    item.y = restingY(this.world.terrain, item.kind, x, z, item.footprint);
    this.world.carrying = this.world.carrying.filter((held) => held !== item);
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
    this.#dragCarried(dt);
    stepPhysics(
      this.world,
      {
        x: this.spider.root.position.x,
        z: this.spider.root.position.z,
        speed: this.spider.speed,
      },
      dt,
    );
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

  /** Move tethered cargo with spring-damper tension and gravity. */
  #dragCarried(dt: number): void {
    if (this.world.carrying.length === 0) return;
    const yaw = this.spider.yaw;
    const back = this.spider.root.position;
    const step = Math.max(dt, 0);
    for (let i = 0; i < this.world.carrying.length; i++) {
      const item = this.world.carrying[i];
      const anchorX = back.x + Math.sin(yaw) * 1.66;
      const anchorZ = back.z + Math.cos(yaw) * 1.66;
      const dx = anchorX - item.x;
      const dz = anchorZ - item.z;
      const dist = Math.hypot(dx, dz);
      const rest = 1.2 + i * 0.45;
      const stretch = Math.max(0, dist - rest);
      const pull = stretch * 8;
      item.vx = (item.vx ?? 0) + (dist > 1e-4 ? (dx / dist) * pull * step : 0);
      item.vz = (item.vz ?? 0) + (dist > 1e-4 ? (dz / dist) * pull * step : 0);
      item.vx *= Math.exp(-3.5 * step);
      item.vz *= Math.exp(-3.5 * step);
      item.x += item.vx * step;
      item.z += item.vz * step;
      const floor = restingY(this.world.terrain, item.kind, item.x, item.z, item.footprint);
      item.vy = (item.vy ?? 0) - 4.5 * step;
      item.y += item.vy * step;
      if (item.y < floor) {
        item.y = floor;
        item.vy = 0;
      }
    }
  }
}
