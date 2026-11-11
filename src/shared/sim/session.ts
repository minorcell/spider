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
} from '@/src/shared/state';
import { islandActor } from '@/src/shared/islandContent';
import { kindOf, slicesOf } from '@/src/shared/kinds';
import { IDLE_CONTROLS } from '@/src/shared/types';
import {
  blockedAt,
  BODY_RADIUS,
  EYE_HEIGHT,
  groundOccluded,
  homeAt,
  occluded,
  SIGHT_TOP,
} from '@/src/shared/sight';
import {
  addEntity,
  createWorld,
  expireEntities,
  grow,
  removeEntity,
  REACH,
  REACH_Y,
  restingY,
  VIEW_DISTANCE,
} from '@/src/shared/world';
import { insideLand, nearestWater, surfaceOf, Terrain, WORLD_RADIUS } from '@/src/shared/terrain';
import { CARRY_LIMIT, MARK_LIMIT, MARK_NAME_MAX, MARK_NOTE_MAX } from '@/src/shared/config';
import {
  heightGoal,
  routeGoal,
  turnGoal,
  walkGoal,
  type Goal,
  type GoalOutcome,
} from '@/src/shared/sim/goals';
import { planRoute } from '@/src/shared/route';
import { applyBody, type SimBody } from '@/src/shared/sim/snapshot';
import { bindWorld } from '@/src/shared/sim/bindWorld';
import { fitsPlacement, stepPhysics } from '@/src/shared/sim/physics';
import {
  carriedItems,
  tetherAnchor,
  tetherLength,
  type TetherMotion,
} from '@/src/shared/sim/tether';
import type { Controller } from '@/src/shared/sim/controller';
import { Spider } from '@/src/shared/sim/Spider';
import { localDate } from '@/src/shared/dates';
import { visualRange, worldClock } from '@/src/shared/ecology';
import { viewDistance } from '@/src/shared/vision';
import { homeLandmarks, type Landmark } from '@/src/shared/landmarks';

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

export type { GoalOutcome } from '@/src/shared/sim/goals';

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
  readonly spider: Spider;
  readonly world: WorldState;

  constructor(seed?: number, terrain?: Terrain) {
    this.world = terrain ? createWorld(terrain.seed, terrain) : createWorld(seed);
    const actor = addEntity(this.world, islandActor.kind, islandActor, 0);
    this.world.controlledId = actor.id;
    this.spider = new Spider(actor);
    bindWorld(this.spider, this.world);
  }

  get actor(): Controller {
    return this.spider.controller;
  }

  #active: ActiveGoal | null = null;
  #landmarkCache: {
    terrain: WorldState['terrain'];
    blocks: WorldState['blocks'];
    landmarks: Landmark[];
  } | null = null;

  landmarks(): Landmark[] {
    if (
      this.#landmarkCache?.terrain !== this.world.terrain ||
      this.#landmarkCache.blocks !== this.world.blocks
    ) {
      this.#landmarkCache = {
        terrain: this.world.terrain,
        blocks: this.world.blocks,
        landmarks: homeLandmarks(this.world),
      };
    }
    return this.#landmarkCache.landmarks;
  }

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
      lamp: this.actor.lamp,
      view: round3(visualRange(clock, this.actor.lamp)),
    };
  }

  get lamp(): boolean {
    return this.actor.lamp;
  }

  setLamp(on: boolean): void {
    this.actor.lamp = on;
  }

  adopt(body: SimBody): void {
    applyBody(this, body);
  }

  observe(distance = VIEW_DISTANCE): Observation {
    const { x, z } = this.actor.position;
    const view = viewDistance(this.world, x, z, this.actor.heightSet, this.actor.lamp, distance);
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
    const { x, z } = this.actor.position;
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
    const { x, z } = this.actor.position;
    const heading = toHeading(this.actor.yaw);
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
        startedAt: this.actor.time,
        guard: undefined as unknown as ReturnType<typeof setTimeout>,
        finish: (outcome: GoalOutcome) => {
          if (this.#active === active) this.#active = null;
          clearTimeout(active.guard);
          goal.cleanup?.();
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
    return this.run(walkGoal(this.actor, distance, fast));
  }

  turn(degrees: number): Promise<GoalOutcome> {
    return this.run(turnGoal(this.actor, degrees));
  }

  turnTo(heading: number): Promise<GoalOutcome> {
    return this.turn(wrapDegrees(heading - toHeading(this.actor.yaw)));
  }

  setHeight(level: number): Promise<GoalOutcome> {
    return this.run(heightGoal(this.actor, level));
  }

  async moveTo(x: number, z: number, fast = false): Promise<GoalOutcome> {
    const limit = WORLD_RADIUS;
    const blocks = this.world.blocks;
    const height = (px: number, pz: number) => surfaceOf(this.world.terrain, px, pz);
    let direct = true;
    const around: string[] = [];
    let last: GoalOutcome = { ok: false, reason: 'no-path', detour: null };

    for (let attempt = 0; attempt < 3; attempt++) {
      const { x: x0, z: z0 } = this.actor.position;
      if (Math.hypot(x - x0, z - z0) <= 0.28) {
        return { ok: true, reason: 'reached', detour: detourNote(around, direct, true) };
      }
      const plan = planRoute(x0, z0, x, z, blocks, height, limit);
      if (!plan) return { ok: false, reason: 'no-path', detour: detourNote(around, direct, false) };
      direct = direct && plan.direct;
      for (const id of plan.around) if (!around.includes(id)) around.push(id);
      last = await this.run(routeGoal(this.actor, plan.points, fast));
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
    const entity = this.world.entities.get(id);
    if (!entity || this.world.tethers.has(id)) {
      return { ok: false, reason: 'not-found', id, detour: null };
    }

    const { x, z } = this.actor.position;
    if (Math.hypot(entity.x - x, entity.z - z) > standoff + 0.05) {
      const spot = this.#standOff(entity, standoff);
      if (!spot) return { ok: false, reason: 'no-path', id, detour: null };
      const moved = await this.moveTo(spot.x, spot.z, fast);
      if (!moved.ok) return { ...moved, id };
      if (this.world.entities.get(entity.id) !== entity)
        return { ok: false, reason: 'not-found', id };
      const face = await this.#face(entity.x, entity.z);
      if (!face.ok) return { ...face, id, detour: moved.detour ?? null };
      return { ok: true, reason: 'reached', id, detour: moved.detour ?? null };
    }
    const face = await this.#face(entity.x, entity.z);
    if (!face.ok) return { ...face, id, detour: null };
    return { ok: true, reason: 'already-close', id, detour: null };
  }

  eat(id?: string): Promise<GoalOutcome> {
    let entity = this.#nearest(id, (item) => kindOf(item.kind)?.eat !== undefined);
    if (!entity && !id)
      entity =
        carriedItems(this.world).find((item) => kindOf(item.kind)?.eat !== undefined) ?? null;
    if (!entity)
      return Promise.resolve({ ok: false, reason: id ? 'not-found' : 'nothing-to-eat', id });
    const kind = kindOf(entity.kind);
    const meal = kind?.eat;
    if (!kind || !meal) return Promise.resolve({ ok: false, reason: 'not-edible', id: entity.id });
    if (!this.world.tethers.has(entity.id)) {
      const reach = this.#reachable(entity);
      if (!reach.ok) return Promise.resolve(reach);
    }

    const target = entity;
    const startedAt = this.actor.time;
    const slices = slicesOf(kind);
    const elapsed0 = slices === 0 ? 0 : (target.stage * meal.duration) / slices;
    const remaining = Math.max(0.05, meal.duration - elapsed0);
    let failure: GoalOutcome | undefined;
    const result = () => ({
      action: 'eat',
      target: target.id,
      stage: target.stage,
      removed: false,
    });

    return this.run({
      timeout: remaining + 1,
      controls: () => IDLE_CONTROLS,
      done: () => {
        if (this.world.entities.get(target.id) !== target) {
          failure = { ok: false, reason: 'not-found', id: target.id };
          return true;
        }
        const elapsed = elapsed0 + this.actor.time - startedAt;
        const finished = elapsed >= meal.duration - 1e-4;
        const stage = Math.min(
          meal.stages,
          Math.floor(((elapsed + 1e-8) * slices) / meal.duration),
        );
        if (!finished && stage <= target.stage) return false;
        if (!this.world.tethers.has(target.id)) {
          const reach = this.#reachable(target);
          if (!reach.ok) {
            failure = reach;
            return true;
          }
        }
        target.stage = Math.max(target.stage, stage);
        return finished;
      },
      result,
      commit: () => {
        if (failure) return { ...result(), ...failure };
        if (meal.removes) removeEntity(this.world, target);
        return { ...result(), ok: true, reason: 'reached', removed: meal.removes };
      },
    });
  }

  pickUp(id?: string): Promise<GoalOutcome> {
    if (this.world.tethers.size >= CARRY_LIMIT) {
      return Promise.resolve({
        ok: false,
        reason: 'full',
        carrying: [...this.world.tethers.keys()],
      });
    }
    const entity = this.#nearest(id, (item) => kindOf(item.kind)?.carryable === true);
    if (!entity || this.world.tethers.has(entity.id))
      return Promise.resolve({ ok: false, reason: id ? 'not-found' : 'nothing-to-carry', id });
    if (!kindOf(entity.kind)?.carryable) {
      return Promise.resolve({ ok: false, reason: 'not-carryable', id: entity.id });
    }
    const reach = this.#reachable(entity);
    if (!reach.ok) return Promise.resolve(reach);

    const startedAt = this.actor.time;
    const result = () => ({ action: 'pick-up', target: entity.id });
    const promise = this.run({
      timeout: 3,
      controls: () => {
        this.spider.setInteraction(entity, 'reach');
        return IDLE_CONTROLS;
      },
      done: () => this.actor.time - startedAt >= 0.35,
      result,
      commit: () => {
        if (this.world.entities.get(entity.id) !== entity)
          return { ok: false, reason: 'not-found', id: entity.id };
        const reached = this.#reachable(entity);
        if (!reached.ok) return reached;
        const anchor = tetherAnchor(this.actor.position, this.actor.yaw);
        this.world.tethers.set(entity.id, tetherLength(anchor, entity, this.world.tethers.size));
        return { ok: true, ...result(), carrying: [...this.world.tethers.keys()] };
      },
      cleanup: () => this.spider.setInteraction(null),
    });
    this.spider.setInteraction(entity, 'reach');
    return promise;
  }

  release(id?: string): GoalOutcome {
    const item = this.#carried(id);
    if (!item) return { ok: false, reason: 'not-carrying', id };
    this.world.tethers.delete(item.id);
    return {
      ok: true,
      action: 'release',
      target: item.id,
      carrying: [...this.world.tethers.keys()],
    };
  }

  drink(): GoalOutcome {
    const { x, z } = this.actor.position;
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
    const spot = this.#spotAhead(item);
    if (!spot) return { ok: false, reason: 'no-room', id: item.id };
    this.#putDown(item, spot.x, spot.z);
    return {
      ok: true,
      action: 'drop',
      target: item.id,
      x: item.x,
      z: item.z,
      carrying: [...this.world.tethers.keys()],
    };
  }

  store(id?: string): GoalOutcome {
    const item = this.#carried(id);
    if (!item) return { ok: false, reason: 'not-carrying', id };
    const { x, z } = this.actor.position;
    const home = homeAt(x, z, this.world.entities.values());
    if (!home) return { ok: false, reason: 'not-home' };
    const spot = this.#stash(item, home);
    if (!spot) return { ok: false, reason: 'no-room' };
    this.#putDown(item, spot.x, spot.z);
    return {
      ok: true,
      action: 'store',
      target: item.id,
      x: item.x,
      z: item.z,
      carrying: [...this.world.tethers.keys()],
    };
  }

  sleep(): Promise<GoalOutcome> {
    const { x, z } = this.actor.position;
    if (!homeAt(x, z, this.world.entities.values()))
      return Promise.resolve({ ok: false, reason: 'not-home' });
    const duration = 4;
    const startedAt = this.actor.time;
    const woke = this.actor.heightSet;
    return this.run({
      timeout: duration + 2,
      controls: () => {
        const elapsed = this.actor.time - startedAt;
        const target = elapsed < duration * 0.75 ? -0.28 : woke;
        const lift =
          Math.abs(this.actor.heightSet - target) < 0.02
            ? 0
            : Math.sign(target - this.actor.heightSet);
        return { ...IDLE_CONTROLS, lift };
      },
      done: () =>
        this.actor.time - startedAt >= duration && Math.abs(this.actor.heightSet - woke) < 0.05,
      result: () => ({ action: 'sleep', home: true }),
    });
  }

  addEntity(kind: string, x: number, z: number): EntityState {
    return addEntity(this.world, kind, { x, z }, this.actor.time);
  }

  #face(x: number, z: number): Promise<GoalOutcome> {
    const bearing =
      (Math.atan2(x - this.actor.position.x, -(z - this.actor.position.z)) * 180) / Math.PI;
    return this.turn(wrapDegrees(bearing - toHeading(this.actor.yaw)));
  }

  #standOff(entity: EntityState, standoff: number): { x: number; z: number } | null {
    const sx = this.actor.position.x;
    const sz = this.actor.position.z;
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
    const { x, z } = this.actor.position;
    if (id) return this.world.entities.get(id) ?? null;
    let nearest: EntityState | null = null;
    let distance = Infinity;
    for (const item of this.world.entities.values()) {
      if (this.world.tethers.has(item.id) || !want(item)) continue;
      const candidate = Math.hypot(item.x - x, item.z - z);
      if (candidate >= distance) continue;
      nearest = item;
      distance = candidate;
    }
    return nearest;
  }

  #reachable(entity: EntityState): GoalOutcome {
    const { x, y, z } = this.actor.position;
    const distance = Math.hypot(entity.x - x, entity.z - z);
    const vertical = Math.abs(entity.y - y);
    if (distance > REACH || vertical > REACH_Y) {
      return { ok: false, reason: 'out-of-reach', id: entity.id, distance };
    }
    const eye = surfaceOf(this.world.terrain, x, z) + EYE_HEIGHT + this.actor.heightSet;
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
    const carried = carriedItems(this.world);
    if (id) return carried.find((item) => item.id === id) ?? null;
    return carried.at(-1) ?? null;
  }

  #spotAhead(item: EntityState): { x: number; z: number } | null {
    const { x, z } = this.actor.position;
    const forward = { x: -Math.sin(this.actor.yaw), z: -Math.cos(this.actor.yaw) };
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
    return spots.find((spot) => fitsPlacement(this.world, item, spot.x, spot.z)) ?? null;
  }

  #stash(item: EntityState, home: EntityState): { x: number; z: number } | null {
    const {
      half,
      storage: { step, start },
    } = kindOf(home.kind)!.home!;
    for (let column = 0; ; column += 1) {
      const x = home.x + start - column * step;
      if (Math.abs(x - home.x) > half) break;
      for (let row = 0; ; row += 1) {
        const z = home.z + start - row * step;
        if (Math.abs(z - home.z) > half) break;
        if (fitsPlacement(this.world, item, x, z)) return { x, z };
      }
    }
    return null;
  }

  #putDown(item: EntityState, x: number, z: number): void {
    item.x = x;
    item.z = z;
    item.y = restingY(this.world.terrain, item.kind, x, z, item.footprint);
    item.vx = item.vy = item.vz = 0;
    this.world.tethers.delete(item.id);
  }

  #step(dt: number): void {
    if (
      this.world.controlledId !== this.actor.entity.id ||
      this.world.entities.get(this.actor.entity.id) !== this.actor.entity
    ) {
      this.#active?.finish({ ok: false, reason: 'stale-actor' });
      return;
    }
    const time = this.actor.time + dt;
    expireEntities(this.world, time);
    grow(this.world, dt, this.actor.position, time);

    const active = this.#active;
    const previous =
      dt > 0 && this.world.tethers.size > 0
        ? tetherAnchor(this.actor.position, this.actor.yaw)
        : undefined;
    const from = {
      x: this.actor.position.x,
      y: this.actor.position.y,
      z: this.actor.position.z,
    };
    const stuckBefore = this.actor.stuckFor;
    const controls = active ? active.goal.controls() : IDLE_CONTROLS;
    this.actor.update(dt, controls);
    const position = this.actor.position;
    let motion: TetherMotion | undefined;
    if (previous) {
      const anchor = tetherAnchor(position, this.actor.yaw);
      motion = {
        position: anchor,
        velocity: {
          x: (anchor.x - previous.x) / dt,
          y: (anchor.y - previous.y) / dt,
          z: (anchor.z - previous.z) / dt,
        },
      };
    }
    const committed = stepPhysics(
      this.world,
      {
        x: position.x,
        z: position.z,
        speed: this.actor.speed,
        radius: this.actor.radius,
        from,
      },
      dt,
      motion,
    );
    this.actor.commit(committed, from, stuckBefore, dt, controls);
    this.spider.present(dt, controls);
    if (!active) return;

    const reached = active.goal.done();
    const overtime = this.actor.time - active.startedAt > active.goal.timeout;
    if (!reached && !overtime) return;

    const detail = active.goal.result();
    const halt = detail.halt;
    const stopped = halt === 'solid' || halt === 'steep';
    if (reached && !stopped && active.goal.commit) {
      active.finish(active.goal.commit());
      return;
    }
    active.finish({
      ok: reached && !stopped,
      reason: stopped ? (halt === 'steep' ? 'steep' : 'blocked') : reached ? 'reached' : 'timeout',
      ...detail,
    });
  }
}
