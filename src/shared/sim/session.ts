import { batchWorldChanges, recordWorldChange } from '@/src/shared/changes';
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
  type ActorState,
  type WorldInfo,
  type WorldState,
  type WorldTime,
} from '@/src/shared/state';
import { islandActor } from '@/src/shared/islandContent';
import { kindOf } from '@/src/shared/kinds';
import { freshnessOf, nourish, tickMetabolism } from '@/src/shared/life';
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
import {
  MARK_LIMIT,
  MARK_NAME_MAX,
  MARK_NOTE_MAX,
  SIMULATION_STEP_SECONDS,
} from '@/src/shared/config';
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
import { bindController } from '@/src/shared/sim/bindController';
import { fitsPlacement, stepPhysics } from '@/src/shared/sim/physics';
import {
  carriedItems,
  attachTether,
  attachmentFailure,
  detachTether,
  heldBy,
} from '@/src/shared/sim/tether';
import { Controller } from '@/src/shared/sim/controller';
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
  readonly actor: Controller;
  activity: Readonly<{ kind: 'pick-up'; targetId: string }> | null = null;
  input = IDLE_CONTROLS;
  readonly world: WorldState;

  constructor(seed?: number, terrain?: Terrain, wallNowMs = Date.now()) {
    this.world = createWorld(terrain?.seed ?? seed, terrain, wallNowMs);
    const actor = addEntity(this.world, islandActor.kind, islandActor);
    this.world.controlledId = actor.id;
    this.actor = new Controller(actor);
    bindController(this.actor, this.world);
  }

  #active: ActiveGoal | null = null;
  #stepBank = 0;
  #stepClock: WorldState['clock'] | null = null;
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

  snapshot(): { state: ActorState; world: WorldState } {
    return { state: this.actor.capture(), world: this.world };
  }

  worldInfo(now = new Date(this.world.clock.wallNowMs)): WorldInfo {
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
    if (this.actor.lamp === on) return;
    this.actor.lamp = on;
    recordWorldChange(this.world, { kind: 'lampChanged', actor: this.actor.entity.id, on });
  }

  adopt(body: SimBody): void {
    applyBody(this, body);
  }

  observe(distance = VIEW_DISTANCE): Observation {
    const { x, z } = this.actor.position;
    const view = viewDistance(this.world, x, z, this.actor.heightSet, this.actor.lamp, distance);
    return toObservation(this.actor.capture(), this.world, REACH, view, REACH_Y);
  }

  sense(withWays = false): Sense {
    return toSense(this.actor.capture(), this.world, withWays);
  }

  near(): NearEntity[] {
    return toNear(this.actor.capture(), this.world, REACH, REACH_Y);
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
    recordWorldChange(this.world, { kind: 'marksChanged' });
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
    recordWorldChange(this.world, { kind: 'marksChanged' });
    return { ok: true, action: 'forget', name: clean };
  }

  async goToMark(name: string, fast = false): Promise<GoalOutcome> {
    const clean = name.trim();
    if (clean.length === 0) return { ok: false, reason: 'need-name' };
    const mark = this.world.marks.find((item) => item.name === clean);
    if (!mark) return { ok: false, reason: 'not-found', name: clean };
    return { ...(await this.moveTo(mark.x, mark.z, fast)), name: clean };
  }

  frame(dt: number, wallNowMs = Date.now()): void {
    if (!Number.isFinite(dt) || !Number.isFinite(wallNowMs) || wallNowMs < 0) return;
    this.reconcileWallTime(wallNowMs);
    if (dt <= 0) return;
    if (this.#stepClock !== this.world.clock) {
      this.#stepClock = this.world.clock;
      this.#stepBank = 0;
    }
    this.#stepBank = Math.min(SIMULATION_STEP_SECONDS * 3, this.#stepBank + dt);
    const steps = Math.floor((this.#stepBank + 1e-9) / SIMULATION_STEP_SECONDS);
    this.#stepBank = Math.max(0, this.#stepBank - steps * SIMULATION_STEP_SECONDS);
    for (let i = 0; i < steps; i++)
      batchWorldChanges(this.world, () => this.#step(SIMULATION_STEP_SECONDS));
  }

  /** Resume/reload expiry without advancing physics, hunger, actions or populations. */
  reconcileWallTime(wallNowMs: number): void {
    if (!Number.isFinite(wallNowMs) || wallNowMs < 0) return;
    batchWorldChanges(this.world, () => {
      const previous = { ...this.world.clock };
      this.world.clock.wallNowMs = wallNowMs;
      this.#expire(previous);
    });
  }

  #expire(previous: WorldTime): void {
    const removed = expireEntities(this.world, previous);
    const active = this.#active;
    if (active?.goal.targets?.some((id) => removed.includes(id)))
      active.finish({ ...active.goal.result(), ok: false, reason: 'expired' });
  }

  run(goal: Goal): Promise<GoalOutcome> {
    const previous = this.#active;
    if (previous) previous.finish({ ok: false, reason: 'cancelled', ...previous.goal.result() });

    return new Promise<GoalOutcome>((resolve) => {
      const active: ActiveGoal = {
        goal,
        startedAt: this.world.clock.simSeconds,
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
    if (!entity || heldBy(this.world, id)) {
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
    const edible = (item: EntityState): boolean => {
      const meal = kindOf(item.kind)?.eat;
      return !!meal && item.stage < meal.bites && freshnessOf(item, this.world.clock) === 'fresh';
    };
    const entity =
      this.#nearest(id, edible) ?? (!id ? carriedItems(this.world).find(edible) : undefined);
    if (!entity)
      return Promise.resolve({ ok: false, reason: id ? 'not-found' : 'nothing-to-eat', id });
    const meal = kindOf(entity.kind)?.eat;
    if (!meal) return Promise.resolve({ ok: false, reason: 'not-edible', id: entity.id });
    if (!kindOf(this.actor.entity.kind)?.metabolism || !this.actor.entity.metabolism)
      return Promise.resolve({ ok: false, reason: 'cannot-eat' });
    if (entity.stage >= meal.bites)
      return Promise.resolve({ ok: false, reason: 'depleted', id: entity.id });
    if (freshnessOf(entity, this.world.clock) !== 'fresh')
      return Promise.resolve({ ok: false, reason: 'spoiled', id: entity.id });
    if (!heldBy(this.world, entity.id)) {
      const reach = this.#reachable(entity);
      if (!reach.ok) return Promise.resolve(reach);
    }

    const target = entity;
    const startedAt = this.world.clock.simSeconds;
    const initialBites = target.stage;
    const biteSeconds =
      Math.ceil(meal.secondsPerBite / SIMULATION_STEP_SECONDS) * SIMULATION_STEP_SECONDS;
    const remaining = (meal.bites - initialBites) * biteSeconds;
    let failure: GoalOutcome | undefined;
    let nutrition = 0;
    const result = () => ({
      action: 'eat',
      target: target.id,
      stage: target.stage,
      nutrition,
      removed: false,
    });

    return this.run({
      targets: [target.id],
      timeout: remaining + 1,
      controls: () => IDLE_CONTROLS,
      done: () => {
        if (this.world.entities.get(target.id) !== target) {
          failure = { ok: false, reason: 'not-found', id: target.id };
          return true;
        }
        if (freshnessOf(target, this.world.clock) !== 'fresh') {
          failure = { ok: false, reason: 'spoiled', id: target.id };
          return true;
        }
        const completed = Math.min(
          meal.bites,
          initialBites + Math.floor((this.world.clock.simSeconds - startedAt + 1e-8) / biteSeconds),
        );
        if (completed <= target.stage) return false;
        if (!heldBy(this.world, target.id)) {
          const reach = this.#reachable(target);
          if (!reach.ok) {
            failure = reach;
            return true;
          }
        }
        const gained = (completed - target.stage) * meal.nutritionPerBite;
        if (!nourish(this.actor.entity, gained)) {
          failure = { ok: false, reason: 'cannot-eat' };
          return true;
        }
        nutrition += gained;
        target.stage = completed;
        recordWorldChange(this.world, {
          kind: 'bite',
          actor: this.actor.entity.id,
          target: target.id,
          completedBites: completed,
          nutrition: gained,
        });
        return completed === meal.bites;
      },
      result,
      commit: () => {
        if (failure) return { ...result(), ...failure };
        if (meal.removes) removeEntity(this.world, target, 'eaten', this.actor.entity.id);
        return { ...result(), ok: true, reason: 'reached', removed: meal.removes };
      },
    });
  }

  pickUp(id?: string): Promise<GoalOutcome> {
    const entity = this.#nearest(id, (item) => kindOf(item.kind)?.carryable !== undefined);
    if (!entity || this.world.tethers.has(entity.id))
      return Promise.resolve({ ok: false, reason: id ? 'not-found' : 'nothing-to-carry', id });
    const failure = attachmentFailure(this.world, this.actor.entity.id, entity.id);
    if (failure)
      return Promise.resolve({
        ok: false,
        reason: failure,
        id: entity.id,
        carrying: carriedItems(this.world).map((item) => item.id),
      });
    const reach = this.#reachable(entity);
    if (!reach.ok) return Promise.resolve(reach);

    const startedAt = this.world.clock.simSeconds;
    const result = () => ({ action: 'pick-up', target: entity.id });
    const promise = this.run({
      targets: [entity.id],
      timeout: 3,
      controls: () => IDLE_CONTROLS,
      done: () => this.world.clock.simSeconds - startedAt >= 0.35,
      result,
      commit: () => {
        if (this.world.entities.get(entity.id) !== entity)
          return { ok: false, reason: 'not-found', id: entity.id };
        const reached = this.#reachable(entity);
        if (!reached.ok) return reached;
        const attached = attachTether(this.world, this.actor.entity.id, entity.id);
        if (!attached.ok) return { ok: false, reason: attached.reason, id: entity.id };
        return { ok: true, ...result(), carrying: carriedItems(this.world).map((item) => item.id) };
      },
      cleanup: () => {
        this.activity = null;
      },
    });
    this.activity = { kind: 'pick-up', targetId: entity.id };
    return promise;
  }

  release(id?: string): GoalOutcome {
    const item = this.#carried(id);
    if (!item) return { ok: false, reason: 'not-carrying', id };
    detachTether(this.world, item.id, 'released');
    return {
      ok: true,
      action: 'release',
      target: item.id,
      carrying: carriedItems(this.world).map((item) => item.id),
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
      carrying: carriedItems(this.world).map((item) => item.id),
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
      carrying: carriedItems(this.world).map((item) => item.id),
    };
  }

  sleep(): Promise<GoalOutcome> {
    const { x, z } = this.actor.position;
    if (!homeAt(x, z, this.world.entities.values()))
      return Promise.resolve({ ok: false, reason: 'not-home' });
    const duration = 4;
    const startedAt = this.world.clock.simSeconds;
    const woke = this.actor.heightSet;
    return this.run({
      timeout: duration + 2,
      controls: () => {
        const elapsed = this.world.clock.simSeconds - startedAt;
        const target = elapsed < duration * 0.75 ? -0.28 : woke;
        const lift =
          Math.abs(this.actor.heightSet - target) < 0.02
            ? 0
            : Math.sign(target - this.actor.heightSet);
        return { ...IDLE_CONTROLS, lift };
      },
      done: () =>
        this.world.clock.simSeconds - startedAt >= duration &&
        Math.abs(this.actor.heightSet - woke) < 0.05,
      result: () => ({ action: 'sleep', home: true }),
    });
  }

  addEntity(kind: string, x: number, z: number): EntityState {
    return addEntity(this.world, kind, { x, z });
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
    detachTether(this.world, item.id, 'placed');
  }

  #step(dt: number): void {
    const previous = { ...this.world.clock };
    this.world.clock.tick += 1;
    this.world.clock.simSeconds += dt;
    this.#expire(previous);
    tickMetabolism(this.world, dt);
    const alive =
      this.world.controlledId === this.actor.entity.id &&
      this.world.entities.get(this.actor.entity.id) === this.actor.entity;
    grow(this.world, dt, alive ? this.actor.position : undefined);
    if (!alive) {
      this.#active?.finish({ ok: false, reason: 'stale-actor' });
      this.input = IDLE_CONTROLS;
      stepPhysics(this.world, undefined, dt);
      return;
    }

    const active = this.#active;
    const from = {
      x: this.actor.position.x,
      y: this.actor.position.y,
      z: this.actor.position.z,
    };
    const stuckBefore = this.actor.stuckFor;
    const haltBefore = this.actor.halt;
    const controls = active ? active.goal.controls() : IDLE_CONTROLS;
    this.actor.update(dt, controls);
    const position = this.actor.position;
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
    );
    this.actor.commit(committed, from, stuckBefore, dt, controls);
    this.input = controls;
    if (haltBefore === 'clear' && this.actor.halt !== 'clear')
      recordWorldChange(this.world, {
        kind: 'blocked',
        actor: this.actor.entity.id,
        by: this.actor.halt,
      });
    if (!active) return;

    const reached = active.goal.done();
    const overtime = this.world.clock.simSeconds - active.startedAt > active.goal.timeout;
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
