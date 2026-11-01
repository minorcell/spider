import { propertiesOf } from './kinds.js';
import { senseBody, type Ahead, type NearbySolid } from './sense.js';
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
  properties: string[];
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
  properties: string[];
}

export interface Observation {
  time: number;
  /** Rebuilds this same island. */
  seed: number;
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
    /** Indices of legs off the ground right now. */
    legsLifting: number[];
  };
  entities: SeenEntity[];
}

/** A foot above this height is mid-swing rather than planted. */
const GROUND_LIFT = 0.17;

const REACH_Y = 1.6;

/** Compass-style degrees from a three.js yaw. */
export function toHeading(yaw: number): number {
  return wrapDegrees((-yaw * 180) / Math.PI);
}

export function wrapDegrees(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export function toObservation(
  state: SpiderState,
  world: WorldState,
  reach: number,
  view: number,
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
      x: Number(entity.x.toFixed(3)),
      y: Number(entity.y.toFixed(3)),
      z: Number(entity.z.toFixed(3)),
      stage: entity.stage,
      properties: propertiesOf(entity.kind),
      distance: Number(distance.toFixed(3)),
      bearing: Number(wrapDegrees((Math.atan2(dx, -dz) * 180) / Math.PI - heading).toFixed(1)),
      inReach: distance <= reach && vertical <= REACH_Y,
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
    time: Number(state.time.toFixed(3)),
    seed: world.seed,
    view: Number(view.toFixed(3)),
    beyond,
    hidden,
    self: {
      x: Number(px.toFixed(3)),
      y: Number(state.position.y.toFixed(3)),
      z: Number(pz.toFixed(3)),
      ground: Number(ground.toFixed(3)),
      heading: Number(heading.toFixed(1)),
      height: Number(state.height.toFixed(3)),
      speed: Number(state.speed.toFixed(3)),
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
      legsLifting: state.feet
        .map((foot, index) =>
          foot.y > world.terrain.height(foot.x, foot.z) + GROUND_LIFT ? index : -1,
        )
        .filter((index) => index >= 0),
    },
    entities: seen,
  };
}
