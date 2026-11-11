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

export const applePopulation = { kind: 'apple', count: 20, home: 6, repair: false, interval: 24 };
export const islandFamilies: readonly IslandFamily[] = [
  { kind: 'grass', count: GRASS, home: 6.5, gap: 5, repair: true },
  applePopulation,
  { kind: 'tree', count: TREES, home: 8.5, gap: 2.6, radius: [0.32, 0.56], repair: true },
  { kind: 'stone', count: 10, home: 6.2, gap: 2.8, radius: [0.5, 1.15], repair: true },
  { kind: 'bog-stone', count: 5, home: 7, gap: 2.4, radius: [0.55, 0.95], repair: true },
];
