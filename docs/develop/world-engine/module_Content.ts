import type { Pose, Registry, Tick, TypeId, UnixMs } from './base';
import type { BodySpec, PhysicsView, Terrain } from './module_Physics';

export interface FoodSpec {
  /** Number of bites required to consume a full item. */
  readonly bites: number;
  /** Simulated duration of one bite. */
  readonly secondsPerBite: number;
  /** Applied by the consumer once a bite commits. */
  readonly nutritionPerBite: number;
}

export interface LifetimeSpec {
  /** Real device time or actively simulated time. */
  readonly clock: 'wall' | 'simulation';
  readonly lifetimeSeconds: number;
  /** Final part of the lifetime during which an item cannot be eaten. */
  readonly rottenSeconds: number;
}

export type Deadline =
  // Store both thresholds so tuning the definition affects new instances.
  | Readonly<{ clock: 'wall'; rotsAtMs: UnixMs; expiresAtMs: UnixMs }>
  | Readonly<{ clock: 'simulation'; rotsAtTick: Tick; expiresAtTick: Tick }>;

export interface ItemType {
  readonly id: TypeId;
  readonly body: BodySpec;
  /** The browser's model registry resolves this ID. */
  readonly modelId: TypeId;
  readonly tetherable: boolean;
  readonly food?: FoodSpec;
  readonly lifetime?: LifetimeSpec;
}

export interface PopulationRule {
  /** Separate from item type so a world can choose whether and where to grow items. */
  readonly id: TypeId;
  readonly itemTypeId: TypeId;
  /** Count instances on the ground. Tethered items can coexist beyond this cap. */
  readonly targetCount: number;
  /** Active seconds below the cap before trying another spawn. */
  readonly intervalSeconds: number;
  /** Registered policy for placement, including spacing and acceptable terrain. */
  readonly placementId: TypeId;
}

export interface PlacementPolicy {
  readonly id: TypeId;
  /** Propose a resting pose using the same terrain and space as movement. */
  pick(terrain: Terrain, physics: PhysicsView, random: () => number): Pose | undefined;
}

export interface ItemCatalog {
  readonly items: Registry<ItemType>;
  readonly populations: Registry<PopulationRule>;
  readonly placements: Registry<PlacementPolicy>;
}
