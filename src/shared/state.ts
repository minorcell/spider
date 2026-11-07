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

export const WATER_SENSE = 8;

export interface WaterSpot {
  x: number;
  z: number;
  distance: number;
  bearing: number;
  depth: number;
  span: number;
}

export interface ShoreSpot {
  x: number;
  z: number;
  distance: number;
  bearing: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpiderState {
  time: number;
  position: Vec3;
  yaw: number;
  speed: number;
  height: number;
  chassisPitch: number;
  chassisRoll: number;
  headYaw: number;
  lamp?: boolean;
  feet: Vec3[];
}

export type Footprint = { kind: 'circle'; r: number } | { kind: 'box'; hx: number; hz: number };

export interface PlaceMark {
  name: string;
  x: number;
  z: number;
  note?: string;
}

export interface EntityState {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  stage: number;
  footprint?: Footprint;
  vx?: number;
  vy?: number;
  vz?: number;
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
}

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
    surface?(x: number, z: number): number;
    inside?(x: number, z: number, margin?: number): boolean;
  };
  entities: EntityState[];
  blocks: Block[];
  marks: PlaceMark[];
  carrying: EntityState[];
  appleIn?: number;
  sprouts?: number;
  physics?: {
    gravity: number;
    damping: number;
    sleepSlope: number;
    sleepSpeed: number;
    maxSpeed: number;
  };
}

export interface ActionHint {
  code: string;
  message: string;
  next?: string;
}

export interface WorldInfo {
  clock: {
    localDate: string;
    localTime: string;
    phase: LightPeriod;
    daylight: number;
  };
  lamp: boolean;
  view: number;
}

export interface SeenEntity {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  stage: number;
  properties: readonly string[];
  distance: number;
  bearing: number;
  inReach: boolean;
}

export interface Carried {
  id: string;
  kind: string;
  stage: number;
  properties: readonly string[];
}

export interface NearEntity {
  id: string;
  kind: string;
  stage: number;
  properties: readonly string[];
  distance: number;
  bearing: number;
}

export interface Observation {
  time: number;
  view: number;
  beyond: number;
  hidden: number;
  hiddenByWall: number;
  hiddenByGround: number;
  self: {
    x: number;
    y: number;
    z: number;
    ground: number;
    heading: number;
    height: number;
    speed: number;
    cover: 'grass' | null;
    home: boolean;
    wet: boolean;
    waterDepth: number;
    swimming: boolean;
    water: WaterSpot | null;
    shore: ShoreSpot | null;
    carrying: Carried[];
    ahead: Ahead;
    nearby: NearbySolid[];
    ways: Waypoint[];
  };
  entities: SeenEntity[];
}

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
  ways?: Waypoint[];
};

export function toHeading(yaw: number): number {
  return wrapDegrees((-yaw * 180) / Math.PI);
}

export function wrapDegrees(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function bearingFrom(dx: number, dz: number, heading: number): number {
  if (dx === 0 && dz === 0) return 0;
  return Math.round(wrapDegrees((Math.atan2(dx, -dz) * 180) / Math.PI - heading) * 10) / 10;
}

function canAct(kind: string): boolean {
  return propertiesOf(kind).some((property) => property !== 'cover' && property !== 'home');
}

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
