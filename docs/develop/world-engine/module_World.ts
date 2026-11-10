import type { Bounds, Clock, EntityId, Mark, TypeId, UnixMs, Vec3 } from './base';
import type { Command, CommandId, WorldEvent } from './module_Action';
import type { ContentCatalog, EntityView } from './module_Entity';
import type { PhysicsView, Terrain } from './module_Physics';
import type { WorldSnapshot } from './module_Snapshot';

export interface WorldView {
  readonly clock: Clock;
  readonly controlledActor: EntityId;
  /** Shared read projection, published only after a world transaction completes. */
  readonly physics: PhysicsView;
  entity(id: EntityId): EntityView | undefined;
  entities(bounds?: Bounds): Iterable<EntityView>;
  marks(): readonly Mark[];
}

export interface WorldFrame {
  /** Read-only state after all changes in the transaction. */
  readonly view: WorldView;
  /** New facts in commit order. A consumer processes each frame once. */
  readonly events: readonly WorldEvent[];
}

export interface WorldConfig {
  readonly terrain: Terrain;
  readonly gravity: Vec3;
  readonly populationIds: readonly TypeId[];
  readonly wallNowMs: UnixMs;
}

export type WorldRestoreResult =
  | Readonly<{ ok: true; world: World }>
  | Readonly<{ ok: false; reason: 'malformed' | 'unknown-type' }>;

export declare class World {
  /** World owns the continuous island. Its shapes are also in the physics read view. */
  readonly terrain: Terrain;
  readonly gravity: Vec3;
  /** Fixed simulation step, 1/60 second for this design. */
  readonly stepSeconds: number;

  static create(config: WorldConfig, catalog: ContentCatalog): World;
  /** Build a detached candidate and reject unknown definitions or invalid relationships. */
  static restore(
    snapshot: WorldSnapshot,
    terrain: Terrain,
    catalog: ContentCatalog,
  ): WorldRestoreResult;

  /** The last committed view is available while paused. */
  view(): WorldView;
  submit(command: Command): CommandId;
  /** Reserve an actor during a user turn and retire an active autonomous command if needed. */
  setAutonomyAllowed(actor: EntityId, allowed: boolean): WorldFrame;
  /** Cancel without advancing either gameplay clock or physics. */
  cancel(command: CommandId): WorldFrame;
  /** Return false for an invalid or duplicate name, or a full mark list. */
  addMark(mark: Mark): boolean;
  removeMark(name: string): boolean;
  /** Run one complete fixed step, using the supplied device time. */
  step(wallNowMs: UnixMs): WorldFrame;
  /** Refresh wall-clock expiry without advancing needs, population or physics. */
  reconcileWallTime(wallNowMs: UnixMs): WorldFrame;
  /** Capture detached data. Action continuations and subscriptions belong to the host. */
  snapshot(): WorldSnapshot;
}
