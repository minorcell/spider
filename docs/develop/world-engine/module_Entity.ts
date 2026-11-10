import type { Clock, EntityId, Json, Registry, TypeId } from './base';
import type { Deadline, FoodSpec, ItemCatalog } from './module_Content';
import type { BodySpec, BodyState, Motion, PhysicsView } from './module_Physics';

export type Freshness = 'fresh' | 'rotten' | 'expired';

export interface DroppedItemData {
  /** Reference to the shared item definition. */
  readonly itemTypeId: TypeId;
  /** Committed bites only. An interrupted bite leaves this unchanged. */
  readonly completedBites: number;
  /** Instance thresholds survive handling and save/load. */
  readonly deadline?: Deadline;
}

export interface FoodSource {
  readonly spec: FoodSpec;
  /** Commits one bite after the action executor revalidates the target. */
  bite(): Readonly<{ completedBites: number; nutrition: number; depleted: boolean }>;
}

export interface Metabolism {
  readonly hunger: number;
  /** Apply one committed bite. The actor clamps its own needs. */
  feed(nutrition: number): void;
}

export interface EntityView {
  readonly id: EntityId;
  readonly typeId: TypeId;
  readonly modelId: TypeId;
  /** Derived from the last committed physics state. */
  readonly body: BodyState;
  /** Shared by rendering, perception, and diagnostics. */
  readonly item?: Readonly<{ itemTypeId: TypeId; completedBites: number; freshness: Freshness }>;
  readonly hunger?: number;
  readonly tetherable: boolean;
}

export interface Entity {
  readonly id: EntityId;
  readonly typeId: TypeId;
  /** Static physical definition. The world owns changes to pose and velocity. */
  readonly bodySpec: BodySpec;
  readonly tetherable: boolean;
  readonly food?: FoodSource;
  readonly metabolism?: Metabolism;
  /** A shared query used for expiry, food validation, and read projections. */
  freshnessAt?(clock: Clock): Freshness;
  /** Update private behavior such as metabolism, and return proposed motion. */
  tick(clock: Clock, dtSeconds: number, physics: PhysicsView): readonly Motion[];
  /** Produce detached read data. Exposes neither an entity class nor a Three.js object. */
  project(body: BodyState, clock: Clock): EntityView;
  /** Serialize instance-owned data. Physics and relations are captured separately. */
  saveData(): Json;
}

export interface EntityType {
  readonly id: TypeId;
  /** Validate instance data and construct the runtime object. */
  create(id: EntityId, data: Json, catalog: ItemCatalog): Entity;
}

export interface ContentCatalog extends ItemCatalog {
  readonly entities: Registry<EntityType>;
}
