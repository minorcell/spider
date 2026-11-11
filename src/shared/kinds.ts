import { grassClumps, grassSeed, grassRadius, grassOnDryGround } from '@/src/shared/grass';
import { nestBankBoxes, nestSolidSurface } from '@/src/shared/nestCollision';
import { GAIT } from '@/src/shared/config';
import { stoneBoxes, stoneSupport } from '@/src/shared/stoneForm';
import { treeBlock } from '@/src/shared/treeForm';
import type { ControlSpec } from '@/src/shared/control';
import type { LifetimeSpec, MetabolismSpec } from '@/src/shared/life';
import type { Block, EntityState, Footprint, Vec3, WorldState } from '@/src/shared/state';

export interface CoverVolume {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface CoverSpec {
  range: number;
  volumes(id: string, radius: number): readonly CoverVolume[];
}

export interface PlacementSpec {
  probe: number;
  footprint(id: string): Footprint;
  fits(terrain: WorldState['terrain'], entity: EntityState): boolean;
}

export interface HomeSpec {
  half: number;
  storage: { start: number; step: number };
  landmark: string;
}

export interface EatSpec {
  bites: number;
  secondsPerBite: number;
  nutritionPerBite: number;
  removes: boolean;
}

export interface PhysicsSpec {
  solid: boolean;
  radius: number;
  loose: boolean;
  rolls: boolean;
  mass?: number;
  volume?: number;
}

export interface BlockSpec {
  radius: number;
  height: number;
}

export type PropModel = string | { readonly color: number; readonly segments: number };

export interface TetherSpec {
  anchor: Vec3;
  limit: number;
  minLength: number;
  spacing: number;
  stiffness: number;
  damping: number;
}

export interface KindSpec {
  rig?: string;
  control?: ControlSpec;
  properties?: readonly string[];
  carryable?: { anchor: Vec3 };
  tether?: TetherSpec;
  label?: string;
  model?: PropModel;
  modelScale?: number;
  lifetime?: LifetimeSpec;
  metabolism?: MetabolismSpec;
  eat?: EatSpec;
  rest: number;
  physics?: PhysicsSpec;
  block?: BlockSpec | ((entity: EntityState) => BlockSpec);
  boxes?: readonly Block[] | ((entity: EntityState) => readonly Block[]);
  support?: (origin: EntityState, x: number, z: number) => number;
  walkable?: true;
  cover?: CoverSpec;
  placement?: PlacementSpec;
  home?: HomeSpec;
  /** Authored placements retain their saved elevation when terrain is regenerated. */
  fixedElevation?: true;
  wet?: boolean;
}

const EMPTY_PROPERTIES: readonly string[] = Object.freeze([]);

export const KINDS: Record<string, KindSpec> = {
  spider: {
    label: '蜘蛛',
    rig: 'spider',
    metabolism: { initialHunger: 25, hungerPerSecond: 1 / 6, maxHunger: 100, forageAt: 60 },
    tether: {
      anchor: { x: 0, y: 0.82, z: 1.66 },
      limit: 7,
      minLength: 1.2,
      spacing: 0.45,
      stiffness: 0.65,
      damping: 0.11,
    },
    rest: 0,
    physics: { solid: true, radius: 0.48, loose: false, rolls: false, mass: 1.2, volume: 2 },
    control: {
      ...GAIT,
      clearance: [
        { c: [0, 0.78, -0.12], r: [0.55, 0.18, 0.46] },
        { c: [0, 0.84, 1.08], r: [0.46, 0.32, 0.62] },
        { c: [0, 0.76, -0.48], r: [0.24, 0.18, 0.26] },
      ],
    },
  },
  apple: {
    carryable: { anchor: { x: 0, y: 0.1944, z: 0 } },
    label: '苹果',
    model: 'apple',
    modelScale: 0.54,
    lifetime: { clock: 'wall', lifetimeSeconds: 24 * 3600, rottenSeconds: 3600 },
    eat: { bites: 6, secondsPerBite: 0.5, nutritionPerBite: 10, removes: true },
    rest: 0,
    physics: { solid: true, radius: 0.1944, loose: true, rolls: true, mass: 0.025, volume: 0.031 },
  },
  pebble: {
    carryable: { anchor: { x: 0, y: 0.19, z: 0 } },
    label: '石子',
    model: 'pebble',
    rest: 0,
    physics: { solid: true, radius: 0.19, loose: true, rolls: true, mass: 0.07 },
  },
  berry: {
    label: '浆果',
    model: 'berry',
    lifetime: { clock: 'wall', lifetimeSeconds: 6 * 3600, rottenSeconds: 30 * 60 },
    eat: { bites: 2, secondsPerBite: 0.5, nutritionPerBite: 4, removes: true },
    rest: 0,
    physics: { solid: true, radius: 0.16, loose: true, rolls: true, mass: 0.018 },
  },
  grass: {
    cover: { range: 4.5, volumes: (id, radius) => grassClumps(radius, grassSeed(id)) },
    placement: {
      probe: 3.2,
      footprint: (id) => ({ kind: 'circle', r: grassRadius(id) }),
      fits: (terrain, entity) =>
        grassOnDryGround(
          (x, z) => terrain.height(x, z),
          entity.x,
          entity.z,
          entity.footprint?.kind === 'circle' ? entity.footprint.r : 1.7,
        ),
    },
    label: '草',
    model: 'grass',
    rest: 0,
    physics: { solid: false, radius: 0, loose: false, rolls: false },
  },
  nest: {
    home: { half: 2.15, storage: { start: 1.15, step: 0.45 }, landmark: '巢穴' },
    fixedElevation: true,
    boxes: nestBankBoxes(),
    support: nestSolidSurface,
    label: '巢',
    model: 'nest',
    rest: 0,
    physics: { solid: true, radius: 0, loose: false, rolls: false },
  },
  tree: {
    label: '树',
    model: 'tree',
    rest: -0.05,
    physics: { solid: true, radius: 0.3, loose: false, rolls: false },
    block: treeBlock,
  },
  stone: {
    label: '石',
    model: 'stone',
    rest: 0,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    boxes: (entity) => stoneBoxes(entity),
    support: (entity, x, z) => stoneSupport(entity, x, z),
    walkable: true,
  },
  'bog-stone': {
    label: '沼石',
    model: 'bog-stone',
    rest: -0.1,
    wet: true,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    boxes: (entity) => stoneBoxes(entity, true),
    support: (entity, x, z) => stoneSupport(entity, x, z, true),
    walkable: true,
  },
};

export function kindOf(kind: string): KindSpec | null {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
}

export function propertiesOf(kind: string): readonly string[] {
  const spec = kindOf(kind);
  const properties = spec?.properties ?? EMPTY_PROPERTIES;
  if (!spec?.eat && !spec?.carryable && !spec?.cover && !spec?.home) return properties;
  const result = [...properties];
  if (spec.eat) result.push('edible');
  if (spec.carryable) result.push('carryable');
  if (spec.cover) result.push('cover');
  if (spec.home) result.push('home');
  return result;
}
