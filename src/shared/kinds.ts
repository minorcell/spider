/**
 * What a thing is, to the spider who senses it.
 * An apple can be eaten or carried. Grass only shortens sight. The nest is home.
 */

export interface EatSpec {
  duration: number;
  stages: number;
  /** Gone from the world, and from later looks, when eating finishes. */
  removes: boolean;
}

/**
 * How a thing takes part in the shared solver.
 * Every kind has one. Motion is not a special case written for one prop.
 */
export interface PhysicsSpec {
  /** Soft things can be walked through. Solid things block. */
  solid: boolean;
  /**
   * Horizontal contact radius. 0 sits on the ground sample at its anchor.
   * A positive radius is lifted to the highest ground under that disc.
   */
  radius: number;
  /** The shared solver moves it: slope, contact, and neighbors. */
  loose: boolean;
  /** A round loose body spins as it travels. The angle is arc length / radius. */
  rolls: boolean;
}

export interface KindSpec {
  /** Sensed qualities. Only the ones that apply. */
  properties: readonly string[];
  eat?: EatSpec;
  /** How far above the ground the origin sits. */
  rest: number;
  physics?: PhysicsSpec;
}

const EMPTY_PROPERTIES: readonly string[] = Object.freeze([]);

export const KINDS: Record<string, KindSpec> = {
  apple: {
    properties: ['edible', 'carryable'],
    eat: { duration: 3, stages: 2, removes: true },
    rest: 0,
    physics: { solid: true, radius: 0.36, loose: true, rolls: true },
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
