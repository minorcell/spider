import { grassClumps, grassSeed, grassRadius, grassOnDryGround } from '@/src/shared/grass';
import { nestSolidSurface } from '@/src/shared/nestCollision';
import { ringBoxes } from '@/src/shared/shapes';
import { GAIT } from '@/src/shared/config';
import type { ControlSpec } from '@/src/shared/control';
import type { Block, EntityState, Footprint, WorldState } from '@/src/shared/state';

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
  duration: number;
  stages: number;
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

export interface KindSpec {
  control?: ControlSpec;
  properties?: readonly string[];
  carryable?: true;
  label?: string;
  model?: PropModel;
  /** Lifetime measured in simulation seconds. */
  lifetime?: number;
  eat?: EatSpec;
  rest: number;
  physics?: PhysicsSpec;
  block?: BlockSpec;
  boxes?: readonly Block[];
  support?: (origin: EntityState, x: number, z: number) => number;
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
    carryable: true,
    label: '苹果',
    model: 'apple',
    eat: { duration: 3, stages: 2, removes: true },
    rest: 0,
    physics: { solid: true, radius: 0.26, loose: true, rolls: true, mass: 0.059, volume: 0.074 },
  },
  pebble: {
    carryable: true,
    label: '石子',
    model: { color: 0x8793a4, segments: 8 },
    rest: 0,
    physics: { solid: true, radius: 0.19, loose: true, rolls: true, mass: 0.07 },
  },
  berry: {
    label: '浆果',
    model: { color: 0xa05f9d, segments: 14 },
    lifetime: 180,
    eat: { duration: 1, stages: 1, removes: true },
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
    boxes: ringBoxes({
      segments: 22,
      radius: 2.62,
      half: 0.42,
      thickness: 0.24,
      door: -Math.PI / 2,
      gap: 0.62,
      height: 0.98,
    }),
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
    block: { radius: 0.62, height: 2.2 },
  },
  stone: {
    label: '石',
    model: 'stone',
    rest: 0,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    block: { radius: 0.82, height: 0.7 },
  },
  'bog-stone': {
    label: '沼石',
    model: 'bog-stone',
    rest: -0.1,
    wet: true,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    block: { radius: 0.82, height: 0.42 },
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

export function slicesOf(kind: KindSpec): number {
  if (!kind.eat) return 0;
  return kind.eat.stages + (kind.eat.removes ? 1 : 0);
}
