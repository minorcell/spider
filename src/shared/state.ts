import { propertiesOf } from './kinds.js';
import {
  aheadAt,
  senseBody,
  waysAt,
  type Ahead,
  type NearbySolid,
  type Waypoint,
} from './sense.js';
import { EYE_HEIGHT, grassHere, groundOccluded, insideHome, occluded, SIGHT_TOP } from './sight.js';

import { surfaceOf } from './terrain.js';
import { floatsAt, nearestShore, readWater, waterAt } from './water.js';
import type { LightPeriod } from './ecology.js';

/** How far a body can feel the nearest water and its shoreline. */
export const WATER_SENSE = 8;

export interface WaterSpot {
  x: number;
  z: number;
  distance: number;
  /** Degrees off the heading, clockwise positive. */
  bearing: number;
  /** Depth at the reported point. */
  depth: number;
  /** Farthest connected water from that point, capped at the sense range. */
  span: number;
}

/** Dry ground within sensing range. Present only while the body is wet. */
export interface ShoreSpot {
  x: number;
  z: number;
  distance: number;
  /** Degrees off the heading, clockwise positive. */
  bearing: number;
}

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
  /** Night lamp. Absent on older saves, which means off. */
  lamp?: boolean;
  /** One entry per leg, in mount order. */
  feet: Vec3[];
}

export type Footprint = { kind: 'circle'; r: number } | { kind: 'box'; hx: number; hz: number };

/** A place the spider has named and can walk back to. Not a physical body. */
export interface PlaceMark {
  /** Unique, trimmed name in the spider's own words. */
  name: string;
  x: number;
  z: number;
  /** Optional line the spider left with the place. */
  note?: string;
}

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
  /** Velocity for props that physics moves. */
  vx?: number;
  vy?: number;
  vz?: number;
  /** Orientation of a body that rolls. Identity when omitted. */
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
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
  terrain: {
    height(x: number, z: number): number;
    /** What a body stands on; the still water level over a hollow. Absent on fixtures. */
    surface?(x: number, z: number): number;
    /** True while the point is still on the island. Absent on hand-built fixtures. */
    inside?(x: number, z: number, margin?: number): boolean;
  };
  entities: EntityState[];
  blocks: Block[];
  /** Places the spider has named. They do not collide, block sight, or count as props. */
  marks: PlaceMark[];
  /** What is on the spider's back, oldest first. Empty when it carries nothing. */
  carrying: EntityState[];
  /**
   * Seconds until the island may grow one apple. Only a world from `createWorld`
   * has this. A hand-built fixture does not grow.
   */
  appleIn?: number;
  /** How many times this island has tried to grow an apple. */
  sprouts?: number;
  /** The island's physical rules. Absent on hand-built test worlds. */
  physics?: {
    gravity: number;
    damping: number;
    sleepSlope: number;
    sleepSpeed: number;
    maxSpeed: number;
  };
}

/** A recovery hint attached to a tool result. It is a fact plus a useful next move. */
export interface ActionHint {
  code: string;
  message: string;
  /** Tool name that can make progress, when there is one obvious next step. */
  next?: string;
}

/** Model-facing world context. It deliberately omits terrain functions and render details. */
export interface WorldInfo {
  clock: {
    /** Client-local calendar date, YYYY-MM-DD. */
    localDate: string;
    /** Client-local wall-clock time, HH:mm:ss. */
    localTime: string;
    /** Local light phase used by the world ecology. */
    phase: LightPeriod;
    /** Continuous local daylight in [0, 1]. */
    daylight: number;
  };
  /** The spider's own lamp. It is not the sun. */
  lamp: boolean;
  /** Fraction of the daytime view at this clock, after the lamp. */
  view: number;
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
  /** Within view, but a wall or the ground stands between you and them. */
  hidden: number;
  /** The part of `hidden` caused by a wall. */
  hiddenByWall: number;
  /** The part of `hidden` caused by a rise in the ground. */
  hiddenByGround: number;
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
    /** True while any water sits under the body. */
    wet: boolean;
    /** How deep the water is under the body. Zero on dry ground. */
    waterDepth: number;
    /** True when the water is deep enough to float instead of wade. */
    swimming: boolean;
    /** Nearest water within a few meters of the body. */
    water: WaterSpot | null;
    /** Nearest dry ground, when the body is in water. */
    shore: ShoreSpot | null;
    /** What is on your back, oldest first. Empty when you carry nothing. */
    carrying: Carried[];
    /** What your heading runs into within the next stretch. */
    ahead: Ahead;
    /** Solids within a few meters, nearest first. */
    nearby: NearbySolid[];
    /** Clear places you can pass to go. */
    ways: Waypoint[];
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
  | 'wet'
  | 'waterDepth'
  | 'swimming'
  | 'water'
  | 'shore'
  | 'carrying'
  | 'ahead'
> & {
  /** Present when the outcome was blocked, steep, or no-path. */
  ways?: Waypoint[];
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
  if (dx === 0 && dz === 0) return 0;
  return Math.round(wrapDegrees((Math.atan2(dx, -dz) * 180) / Math.PI - heading) * 10) / 10;
}

/** Cover and home are already on the body. Anything else can be acted on. */
function canAct(kind: string): boolean {
  return propertiesOf(kind).some((property) => property !== 'cover' && property !== 'home');
}

/**
 * The body alone. One heading probe. `withWays` also scans 24 headings for
 * clear places, which a blocked action attaches so the next go needs no observe.
 */
export function toSense(state: SpiderState, world: WorldState, withWays = false): Sense {
  const heading = toHeading(state.yaw);
  const px = state.position.x;
  const pz = state.position.z;
  const height = (x: number, z: number) => surfaceOf(world.terrain, x, z);
  const ground = surfaceOf(world.terrain, px, pz);
  const inside = world.terrain.inside
    ? (x: number, z: number, margin?: number): boolean => world.terrain.inside!(x, z, margin)
    : undefined;
  const eye = ground + EYE_HEIGHT + state.height;
  const waterDepth = waterAt(world.terrain, px, pz).depth;
  const swimming = floatsAt(world.terrain, px, pz);
  const water = readWater(world.terrain, px, pz, WATER_SENSE);
  const shore = waterDepth > 0 ? nearestShore(world.terrain, px, pz, WATER_SENSE) : null;
  const sense: Sense = {
    x: round3(px),
    y: round3(state.position.y),
    z: round3(pz),
    ground: round3(ground),
    heading: Math.round(heading * 10) / 10,
    height: round3(state.height),
    speed: round3(state.speed),
    cover: grassHere(px, pz, world.entities, eye) ? 'grass' : null,
    home: insideHome(px, pz),
    wet: waterDepth > 0,
    waterDepth: round3(waterDepth),
    swimming,
    water: water
      ? {
          x: round3(water.x),
          z: round3(water.z),
          distance: round3(water.distance),
          bearing: bearingFrom(water.x - px, water.z - pz, heading),
          depth: round3(water.depth),
          span: round3(water.span),
        }
      : null,
    shore: shore
      ? {
          x: round3(shore.x),
          z: round3(shore.z),
          distance: round3(shore.distance),
          bearing: bearingFrom(shore.x - px, shore.z - pz, heading),
        }
      : null,
    carrying: world.carrying.map((item) => ({
      id: item.id,
      kind: item.kind,
      stage: item.stage,
      properties: propertiesOf(item.kind),
    })),
    ahead: aheadAt(px, pz, heading, height, world.blocks, inside),
  };
  if (withWays) sense.ways = waysAt(px, pz, heading, height, world.blocks, inside);
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
  let hiddenByWall = 0;
  let hiddenByGround = 0;
  const px = state.position.x;
  const pz = state.position.z;
  const height = (x: number, z: number): number => world.terrain.height(x, z);
  const ground = surfaceOf(world.terrain, px, pz);
  const inside = world.terrain.inside
    ? (x: number, z: number, margin?: number): boolean => world.terrain.inside!(x, z, margin)
    : undefined;
  const waterDepth = waterAt(world.terrain, px, pz).depth;
  const swimming = floatsAt(world.terrain, px, pz);
  const water = readWater(world.terrain, px, pz, WATER_SENSE);
  const shore = waterDepth > 0 ? nearestShore(world.terrain, px, pz, WATER_SENSE) : null;
  const eye = ground + EYE_HEIGHT + state.height;
  for (const entity of world.entities) {
    const dx = entity.x - px;
    const dz = entity.z - pz;
    const distance = Math.hypot(dx, dz);
    if (distance > view) {
      beyond += 1;
      continue;
    }
    const wall = occluded(px, pz, entity.x, entity.z, world.blocks, entity.id, eye);
    const rise =
      !wall && groundOccluded(px, pz, eye, entity.x, entity.y + SIGHT_TOP, entity.z, height);
    if (wall || rise) {
      hidden += 1;
      if (wall) hiddenByWall += 1;
      else hiddenByGround += 1;
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
    inside,
  );
  return {
    time: round3(state.time),
    view: round3(view),
    beyond,
    hidden,
    hiddenByWall,
    hiddenByGround,
    self: {
      x: round3(px),
      y: round3(state.position.y),
      z: round3(pz),
      ground: round3(ground),
      heading: Math.round(heading * 10) / 10,
      height: round3(state.height),
      speed: round3(state.speed),
      cover: grassHere(px, pz, world.entities, eye) ? 'grass' : null,
      home: insideHome(px, pz),
      wet: waterDepth > 0,
      waterDepth: round3(waterDepth),
      swimming,
      water: water
        ? {
            x: round3(water.x),
            z: round3(water.z),
            distance: round3(water.distance),
            bearing: bearingFrom(water.x - px, water.z - pz, heading),
            depth: round3(water.depth),
            span: round3(water.span),
          }
        : null,
      shore: shore
        ? {
            x: round3(shore.x),
            z: round3(shore.z),
            distance: round3(shore.distance),
            bearing: bearingFrom(shore.x - px, shore.z - pz, heading),
          }
        : null,
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
  const height = (x: number, z: number): number => world.terrain.height(x, z);
  const eye = surfaceOf(world.terrain, px, pz) + EYE_HEIGHT + state.height;
  const near: NearEntity[] = [];
  for (const entity of world.entities) {
    if (!canAct(entity.kind)) continue;
    const dx = entity.x - px;
    const dz = entity.z - pz;
    const distance = Math.hypot(dx, dz);
    const vertical = Math.abs(entity.y - state.position.y);
    if (distance > reach || vertical > reachY) continue;
    if (occluded(px, pz, entity.x, entity.z, world.blocks, entity.id, eye)) continue;
    if (groundOccluded(px, pz, eye, entity.x, entity.y + SIGHT_TOP, entity.z, height)) continue;
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
