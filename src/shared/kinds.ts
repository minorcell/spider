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

export interface PixelAppearance {
  readonly base: string;
  readonly top: string;
  readonly shade: string;
  readonly shape: 'stone' | 'fruit' | 'tree' | 'grass';
}

export const STONE_PIXELS: PixelAppearance = {
  base: '#74817a',
  top: '#a0ac93',
  shade: '#43534c',
  shape: 'stone',
};

export interface KindSpec {
  properties?: readonly string[];
  carryable?: true;
  pixels?: PixelAppearance | false;
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
    pixels: { base: '#cb6550', top: '#f2a27c', shade: '#7c433b', shape: 'fruit' },
    eat: { duration: 3, stages: 2, removes: true },
    rest: 0,
    physics: { solid: true, radius: 0.26, loose: true, rolls: true, mass: 0.059, volume: 0.074 },
  },
  grass: {
    properties: ['cover'],
    pixels: { base: '#688651', top: '#9aaa67', shade: '#456b48', shape: 'grass' },
    rest: 0,
    physics: { solid: false, radius: 0, loose: false, rolls: false },
  },
  nest: {
    properties: ['home'],
    pixels: false,
    rest: 0,
    physics: { solid: true, radius: 0, loose: false, rolls: false },
  },
  tree: {
    pixels: { base: '#3c6447', top: '#719554', shade: '#2a4e39', shape: 'tree' },
    rest: -0.05,
    physics: { solid: true, radius: 0.3, loose: false, rolls: false },
    block: { radius: 0.62, height: 2.2 },
  },
  stone: {
    pixels: STONE_PIXELS,
    rest: 0,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    block: { radius: 0.82, height: 0.7 },
  },
  'bog-stone': {
    pixels: { base: '#657b6b', top: '#98a47c', shade: '#40594c', shape: 'stone' },
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
