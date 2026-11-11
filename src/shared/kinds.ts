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

export type PropModel =
  | 'apple'
  | 'grass'
  | 'nest'
  | 'tree'
  | 'stone'
  | 'bog-stone'
  | { readonly color: number; readonly segments: number };

export interface KindSpec {
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
  wet?: boolean;
}

const EMPTY_PROPERTIES: readonly string[] = Object.freeze([]);

export const KINDS: Record<string, KindSpec> = {
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
    properties: ['cover'],
    label: '草',
    model: 'grass',
    rest: 0,
    physics: { solid: false, radius: 0, loose: false, rolls: false },
  },
  nest: {
    properties: ['home'],
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
  if (!spec?.eat && !spec?.carryable) return properties;
  const result = [...properties];
  if (spec.eat) result.push('edible');
  if (spec.carryable) result.push('carryable');
  return result;
}

export function slicesOf(kind: KindSpec): number {
  if (!kind.eat) return 0;
  return kind.eat.stages + (kind.eat.removes ? 1 : 0);
}
