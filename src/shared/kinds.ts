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
   * A positive radius rests as a sphere on the heightfield.
   */
  radius: number;
  /** The shared solver moves it: slope, contact, and neighbors. */
  loose: boolean;
  /** A round loose body spins as it travels. The angle is arc length / radius. */
  rolls: boolean;
  /** Mass for weight. Defaults to the volume when omitted. */
  mass?: number;
  /** Full displaced volume. Defaults to the sphere of `radius`. */
  volume?: number;
}

/** How a fixed kind takes a place in the world's wall list. */
export interface BlockSpec {
  /** Fraction of the footprint radius that blocks the body. */
  radius: number;
  /** Top of the box. Below the eye it blocks the feet but not the view. */
  height: number;
}

export interface KindSpec {
  /** Sensed qualities. Only the ones that apply. */
  properties: readonly string[];
  eat?: EatSpec;
  /** How far above the ground the origin sits. Negative sinks it in. */
  rest: number;
  physics?: PhysicsSpec;
  block?: BlockSpec;
  /** This kind belongs in shallow water, half sunk. */
  wet?: boolean;
}

const EMPTY_PROPERTIES: readonly string[] = Object.freeze([]);

export const KINDS: Record<string, KindSpec> = {
  apple: {
    properties: ['edible', 'carryable'],
    eat: { duration: 3, stages: 2, removes: true },
    rest: 0,
    // Density 0.8: buoyancy cancels most of its weight, so roughly the top
    // fifth of the apple stays above the water line. The body is the drawn
    // mesh at APPLE_SCALE, not the old full-size fruit.
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
    // Roots sink a little so a trunk on a slope does not hover.
    rest: -0.05,
    physics: { solid: true, radius: 0.3, loose: false, rolls: false },
    // A thin trunk stops the body. It is tall enough to hide what is behind it.
    block: { radius: 0.62, height: 2.2 },
  },
  stone: {
    properties: EMPTY_PROPERTIES,
    rest: 0,
    physics: { solid: true, radius: 0.8, loose: false, rolls: false },
    // A boulder is walked around, but the eye still clears it.
    block: { radius: 0.82, height: 0.7 },
  },
  'bog-stone': {
    properties: EMPTY_PROPERTIES,
    // Half sunk in shallow water; the crown and reeds stay above the surface.
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
