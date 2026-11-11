export const GRASS = 32;
export const TREES = 24;

export interface ScatterOptions {
  readonly gap?: number;
  readonly radius?: readonly [number, number];
}

interface IslandFamily extends ScatterOptions {
  readonly kind: string;
  readonly count: number;
  readonly home: number;
  readonly repair: boolean;
}

export interface PopulationRule extends Pick<ScatterOptions, 'gap'> {
  readonly id: string;
  readonly kind: string;
  readonly count: number;
  readonly home: number;
  readonly interval: number;
  readonly salt: number;
}

export interface PopulationState {
  remaining: number;
  attempts: number;
}

export const applePopulation: PopulationRule = {
  id: 'apple',
  kind: 'apple',
  count: 20,
  home: 6,
  interval: 24,
  salt: 0x51f15e,
};
const pebblePopulation: PopulationRule = {
  id: 'pebbles',
  kind: 'pebble',
  count: 6,
  home: 4.5,
  gap: 2.4,
  interval: 18,
  salt: 0x706562,
};
const berryPopulation: PopulationRule = {
  id: 'berries',
  kind: 'berry',
  count: 8,
  home: 4.5,
  gap: 2.4,
  interval: 12,
  salt: 0x626572,
};
export const populationRules: readonly PopulationRule[] = [
  applePopulation,
  pebblePopulation,
  berryPopulation,
];

export function initialPopulations(): Map<string, PopulationState> {
  return new Map(
    populationRules.map((rule) => [rule.id, { remaining: rule.interval, attempts: 0 }]),
  );
}
export const islandFamilies: readonly IslandFamily[] = [
  { kind: 'grass', count: GRASS, home: 6.5, gap: 5, repair: true },
  { ...applePopulation, repair: false },
  { kind: 'tree', count: TREES, home: 8.5, gap: 2.6, radius: [0.32, 0.56], repair: true },
  { kind: 'stone', count: 10, home: 6.2, gap: 2.8, radius: [0.5, 1.15], repair: true },
  { kind: 'bog-stone', count: 5, home: 7, gap: 2.4, radius: [0.55, 0.95], repair: true },
  { ...pebblePopulation, repair: false },
  { ...berryPopulation, repair: false },
];
