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

export interface KindSpec {
  /** Sensed qualities. Only the ones that apply. */
  properties: readonly string[];
  eat?: EatSpec;
  /** How far above the ground the origin sits. */
  rest: number;
}

const EMPTY_PROPERTIES: readonly string[] = Object.freeze([]);

export const KINDS: Record<string, KindSpec> = {
  apple: {
    properties: ['edible', 'carryable'],
    eat: { duration: 3, stages: 2, removes: true },
    rest: 0,
  },
  grass: { properties: ['cover'], rest: 0 },
  nest: { properties: ['home'], rest: 0 },
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
