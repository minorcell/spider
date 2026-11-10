import type { Clock, EntityId, Vec3 } from './base';
import type { Entity } from './module_Entity';
import type { Motion, PhysicsView, Tether } from './module_Physics';

export type CommandId = string;
export type RemovalCause = 'expired' | 'eaten' | 'despawned';

export type Action =
  | Readonly<{ kind: 'moveTo'; position: Vec3; fast?: boolean }>
  | Readonly<{ kind: 'approach'; target: EntityId; standoff?: number; fast?: boolean }>
  | Readonly<{ kind: 'walk'; distance: number; fast?: boolean }>
  | Readonly<{ kind: 'turn'; degrees: number; relative: boolean }>
  | Readonly<{ kind: 'setHeight'; height: number }>
  | Readonly<{ kind: 'setLamp'; on: boolean }>
  // Release only detaches. Drop and store preserve the placement behavior of existing tools.
  | Readonly<{ kind: 'eat' | 'tether' | 'release' | 'drop' | 'store'; target: EntityId }>
  | Readonly<{ kind: 'drink' | 'sleep' }>;

export interface Command {
  readonly actor: EntityId;
  /** A user command can supersede autonomous work on the same actor. */
  readonly source: 'user' | 'autonomous';
  readonly action: Action;
}

export type Failure =
  | 'cancelled'
  | 'stale-target'
  | 'out-of-reach'
  | 'blocked'
  | 'steep'
  | 'no-path'
  | 'spoiled'
  | 'not-edible'
  | 'not-carryable'
  | 'not-carrying'
  | 'not-home'
  | 'no-room'
  | 'no-water'
  | 'full'
  | 'timeout'
  | 'invalid';

export type ActionDetail =
  | Readonly<{ kind: 'navigation'; position: Vec3; around: readonly EntityId[] }>
  | Readonly<{ kind: 'meal'; target: EntityId; completedBites: number; removed: boolean }>;

export type Outcome =
  | Readonly<{ ok: true; detail?: ActionDetail }>
  | Readonly<{ ok: false; reason: Failure; detail?: ActionDetail }>;

export type WorldEvent =
  | Readonly<{ kind: 'freshnessChanged'; entity: EntityId; to: 'rotten' }>
  | Readonly<{ kind: 'bite'; actor: EntityId; target: EntityId; completedBites: number }>
  | Readonly<{ kind: 'tetherChanged'; tether: Tether; attached: boolean }>
  | Readonly<{ kind: 'removed'; entity: EntityId; cause: RemovalCause }>
  // Every accepted command reaches one terminal event, including cancellation and expiry.
  | Readonly<{ kind: 'actionFinished'; command: CommandId; outcome: Outcome }>;

export interface ActionWorld {
  readonly clock: Clock;
  readonly physics: PhysicsView;
  /** This capability is internal to the world transaction. */
  entity(id: EntityId): Entity | undefined;
  /** Applies the same vertical reach and occlusion rules used by observation. */
  checkReach(actor: EntityId, target: EntityId): 'out-of-reach' | 'blocked' | undefined;
  /** Check capacity, reach, target liveness and existing ownership before attaching. */
  attach(carrier: EntityId, target: EntityId): Failure | undefined;
  release(carrier: EntityId, target: EntityId): void;
  /** Validate destination before changing body pose or removing the tether. */
  place(carrier: EntityId, target: EntityId, destination: 'ahead' | 'home'): Failure | undefined;
  /** Cleans up body, relationships and unfinished commands that refer to the ID. */
  remove(target: EntityId, cause: RemovalCause): void;
  /** Publishes a fact from this transaction. */
  emit(event: WorldEvent): void;
  /** Retires the command immediately and queues its one terminal event. */
  finish(command: CommandId, outcome: Outcome): void;
}

export interface ActionExecutor {
  /** Store the command and allocate a receipt. World controls when work runs. */
  submit(command: Command): CommandId;
  /** Resolve cancellation in the current world transaction, even while simulation is paused. */
  cancel(id: CommandId, world: ActionWorld): void;
  /** Resolve arbitration and produce controller input for this simulation step. */
  plan(world: ActionWorld): readonly Motion[];
  /** Check solved movement and complete only the actions whose effects have committed. */
  settle(world: ActionWorld): void;
  /** Retire unfinished commands that depend on a removed actor or target. */
  invalidate(entity: EntityId, world: ActionWorld): void;
}
