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

export interface KindSpec {
  properties: readonly string[];
  eat?: EatSpec;
  rest: number;
  physics?: PhysicsSpec;
  block?: BlockSpec;
  wet?: boolean;
}

const EMPTY_PROPERTIES: readonly string[] = Object.freeze([]);

export const KINDS: Record<string, KindSpec> = {
  apple: {
    properties: ['edible', 'carryable'],
    eat: { duration: 3, stages: 2, removes: true },
    rest: 0,
    physics: { solid: true, radius: 0.26, loose: true, rolls: true, mass: 0.059, volume: 0.074 },
  },
  grass: {
    properties: ['cover'],
    rest: 0,
    physics: { solid: false, radius: 0, loose: false, rolls: false },
  },
  nest: {
    properties: ['home'],
    rest: 0,
    physics: { solid: true, radius: 0, loose: false, rolls: false },
  },
  tree: {
    properties: EMPTY_PROPERTIES,
    rest: -0.05,
    physics: { solid: true, radius: 0.3, loose: false, rolls: false },
    block: { radius: 0.62, height: 2.2 },
  },
  stone: {
    properties: EMPTY_PROPERTIES,
    rest: 0,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    block: { radius: 0.82, height: 0.7 },
  },
  'bog-stone': {
    properties: EMPTY_PROPERTIES,
    rest: -0.1,
    wet: true,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    block: { radius: 0.82, height: 0.42 },
  },
};

export function kindOf(kind: string): KindSpec | null {
  return KINDS[kind] ?? null;
}

export function propertiesOf(kind: string): readonly string[] {
  return KINDS[kind]?.properties ?? EMPTY_PROPERTIES;
}

export function slicesOf(kind: KindSpec): number {
  if (!kind.eat) return 0;
  return kind.eat.stages + (kind.eat.removes ? 1 : 0);
}
