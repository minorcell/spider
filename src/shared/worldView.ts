import type { PopulationState } from '@/src/shared/islandContent';
import type {
  EntityState,
  PlaceMark,
  TetherRelation,
  WorldState,
  WorldTime,
} from '@/src/shared/state';

/** The one data projection shared by saved worlds and committed reader views. */
export interface WorldData {
  seed: number;
  clock: WorldTime;
  controlledId?: string;
  entities: EntityState[];
  tethers: TetherRelation[];
  marks: PlaceMark[];
  populations: Record<string, PopulationState>;
  entitySerials: Record<string, number>;
}

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type WorldView = Immutable<WorldData>;

/** No definition, terrain service, map or entity from the live world escapes this copy. */
export function captureWorldData(world: WorldState): WorldData {
  return structuredClone({
    seed: world.seed,
    clock: world.clock,
    controlledId: world.controlledId,
    entities: [...world.entities.values()],
    tethers: [...world.tethers.values()],
    marks: world.marks,
    populations: Object.fromEntries(world.populations),
    entitySerials: Object.fromEntries(world.entitySerials),
  });
}

export function captureWorldView(world: WorldState): WorldView {
  return freeze(captureWorldData(world));
}

function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
