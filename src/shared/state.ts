import { propertiesOf } from './kinds.js';
import { aheadAt, senseBody, waysAt, type Ahead, type NearbySolid } from './sense.js';
import { grassHere, insideHome, occluded } from './sight.js';

/** Serializable simulation state, world state, and the observation format. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpiderState {
  time: number;
  position: Vec3;
  /** three.js yaw in radians; the body's forward is -Z rotated by this. */
  yaw: number;
  speed: number;
  /** Target deck height, the value the lift keys move. */
  height: number;
  chassisPitch: number;
  chassisRoll: number;
  headYaw: number;
  /** One entry per leg, in mount order. */
  feet: Vec3[];
}

export type Footprint = { kind: 'circle'; r: number } | { kind: 'box'; hx: number; hz: number };

export interface EntityState {
  id: string;
  kind: string;
  x: number;
  /** World height of the origin. */
  y: number;
  z: number;
  /** How far an action has progressed. 0 is untouched. */
  stage: number;
  /** Collision or cover size. Not reported in a look. */
  footprint?: Footprint;
}

/** A solid the spider cannot enter, and cannot see through. */
export interface Block {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface WorldState {
  seed: number;
  terrain: { height(x: number, z: number): number };
  entities: EntityState[];
  blocks: Block[];
  /** What is on the spider's back, oldest first. Empty when it carries nothing. */
  carrying: EntityState[];
  /**
   * Seconds until the island may grow one apple. Only a world from `createWorld`
   * has this. A hand-built fixture does not grow.
   */
  appleIn?: number;
  /** How many times this island has tried to grow an apple. */
  sprouts?: number;
}

export interface SeenEntity {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  stage: number;
  /** Qualities you can act on, such as edible or carryable. */
  properties: readonly string[];
  /** Horizontal units from you. */
  distance: number;
  /** Degrees relative to your heading, clockwise positive. */
  bearing: number;
  /** Close enough to act on, and not behind a solid. */
  inReach: boolean;
}

export interface Carried {
  id: string;
  kind: string;
  stage: number;
  properties: readonly string[];
}

/**
 * Something within reach that can be eaten or carried.
 * Absolute position stays on a full look; this is enough to act.
 */
export interface NearEntity {
  id: string;
  kind: string;
  stage: number;
  properties: readonly string[];
  /** Horizontal units from you. */
  distance: number;
  /** Degrees relative to your heading, clockwise positive. */
  bearing: number;
}

export interface Observation {
  time: number;
  /** How far this look actually reached. */
  view: number;
  /** Left out because they sit past view. */
  beyond: number;
  /** Within view, but a solid stands between you and them. */
  hidden: number;
  self: {
    x: number;
    /** Your height. */
    y: number;
    z: number;
    /** Height of the ground under you. */
    ground: number;
    /** Degrees. 0 is world -Z, clockwise positive. */
    heading: number;
    /** How far you are lifted off the ground. */
    height: number;
    speed: number;
    /** grass while you are standing in it. */
    cover: 'grass' | null;
    /** True while you are inside the nest. */
    home: boolean;
    /** What is on your back, oldest first. Empty when you carry nothing. */
    carrying: Carried[];
    /** What your heading runs into within the next stretch. */
    ahead: Ahead;
    /** Solids within a few meters, nearest first. */
    nearby: NearbySolid[];
    /** Computed sentences: which relative turn is walkable, and for how far. */
    ways: string[];
  };
  entities: SeenEntity[];
}

/** The body's own state, without the island around it. */
export type Sense = Pick<
  Observation['self'],
  | 'x'
  | 'y'
  | 'z'
  | 'ground'
  | 'heading'
  | 'height'
  | 'speed'
  | 'cover'
  | 'home'
  | 'carrying'
  | 'ahead'
> & {
  /** Present when the outcome was blocked, steep, or no-path. */
  ways?: string[];
};

/** Compass-style degrees from a three.js yaw. */
export function toHeading(yaw: number): number {
  return wrapDegrees((-yaw * 180) / Math.PI);
}

export function wrapDegrees(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Split the difference for the wire: three places, a number, no string. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Degrees off the heading. 0 is straight ahead, clockwise positive. */
function bearingFrom(dx: number, dz: number, heading: number): number {
  return Math.round(wrapDegrees((Math.atan2(dx, -dz) * 180) / Math.PI - heading) * 10) / 10;
}

/** Cover and home are already on the body. Anything else can be acted on. */
function canAct(kind: string): boolean {
  return propertiesOf(kind).some((property) => property !== 'cover' && property !== 'home');
}

/**
 * The body alone. One heading probe. `withWays` also scans 24 headings for
 * turn sentences, which a blocked action attaches so the next turn needs no observe.
 */
export function toSense(state: SpiderState, world: WorldState, withWays = false): Sense {
  const heading = toHeading(state.yaw);
  const px = state.position.x;
  const pz = state.position.z;
  const height = (x: number, z: number) => world.terrain.height(x, z);
  const sense: Sense = {
    x: round3(px),
    y: round3(state.position.y),
    z: round3(pz),
    ground: round3(world.terrain.height(px, pz)),
    heading: Math.round(heading * 10) / 10,
    height: round3(state.height),
    speed: round3(state.speed),
    cover: grassHere(px, pz, world.entities) ? 'grass' : null,
    home: insideHome(px, pz),
    carrying: world.carrying.map((item) => ({
      id: item.id,
      kind: item.kind,
      stage: item.stage,
      properties: propertiesOf(item.kind),
    })),
    ahead: aheadAt(px, pz, heading, height, world.blocks),
  };
  if (withWays) sense.ways = waysAt(px, pz, heading, height, world.blocks);
  return sense;
}

export function toObservation(
  state: SpiderState,
  world: WorldState,
  reach: number,
  view: number,
  reachY: number,
): Observation {
  const heading = toHeading(state.yaw);
  const seen: SeenEntity[] = [];
  let beyond = 0;
  let hidden = 0;
  const px = state.position.x;
  const pz = state.position.z;
  const ground = world.terrain.height(px, pz);
  const eye = ground + 0.85;
  for (const entity of world.entities) {
    const dx = entity.x - px;
    const dz = entity.z - pz;
    const distance = Math.hypot(dx, dz);
    if (distance > view) {
      beyond += 1;
      continue;
    }
    const behind = occluded(px, pz, entity.x, entity.z, world.blocks, entity.id, eye);
    if (behind) {
      hidden += 1;
      continue;
    }
    const vertical = Math.abs(entity.y - state.position.y);
    seen.push({
      id: entity.id,
      kind: entity.kind,
      x: round3(entity.x),
      y: round3(entity.y),
      z: round3(entity.z),
      stage: entity.stage,
      properties: propertiesOf(entity.kind),
      distance: round3(distance),
      bearing: bearingFrom(dx, dz, heading),
      inReach: distance <= reach && vertical <= reachY,
    });
  }
  const carrying = world.carrying;
  const felt = senseBody(
    px,
    pz,
    state.yaw,
    heading,
    (x, z) => world.terrain.height(x, z),
    world.blocks,
  );
  return {
    time: round3(state.time),
    view: round3(view),
    beyond,
    hidden,
    self: {
      x: round3(px),
      y: round3(state.position.y),
      z: round3(pz),
      ground: round3(ground),
      heading: Math.round(heading * 10) / 10,
      height: round3(state.height),
      speed: round3(state.speed),
      cover: grassHere(px, pz, world.entities) ? 'grass' : null,
      home: insideHome(px, pz),
      carrying: carrying.map((item) => ({
        id: item.id,
        kind: item.kind,
        stage: item.stage,
        properties: propertiesOf(item.kind),
      })),
      ahead: felt.ahead,
      nearby: felt.nearby,
      ways: felt.ways,
    },
    entities: seen,
  };
}

/**
 * What you can eat or carry without another look. Nearest first.
 * Grass and the nest stay off the list. An empty list means nothing in reach.
 */
export function toNear(
  state: SpiderState,
  world: WorldState,
  reach: number,
  reachY: number,
): NearEntity[] {
  const heading = toHeading(state.yaw);
  const px = state.position.x;
  const pz = state.position.z;
  const eye = world.terrain.height(px, pz) + 0.85;
  const near: NearEntity[] = [];
  for (const entity of world.entities) {
    if (!canAct(entity.kind)) continue;
    const dx = entity.x - px;
    const dz = entity.z - pz;
    const distance = Math.hypot(dx, dz);
    const vertical = Math.abs(entity.y - state.position.y);
    if (distance > reach || vertical > reachY) continue;
    if (occluded(px, pz, entity.x, entity.z, world.blocks, entity.id, eye)) continue;
    near.push({
      id: entity.id,
      kind: entity.kind,
      stage: entity.stage,
      properties: propertiesOf(entity.kind),
      distance: round3(distance),
      bearing: bearingFrom(dx, dz, heading),
    });
  }
  near.sort((a, b) => a.distance - b.distance);
  return near;
}
