import type { EntityId, Json, Mark, Tick, TypeId, UnixMs, Vec3 } from './base';
import type { BodyState, Tether } from './module_Physics';

export interface EntityRecord {
  readonly id: EntityId;
  readonly typeId: TypeId;
  /** Body pose and velocity are saved separately from entity behavior data. */
  readonly body: BodyState;
  /** Validated by the registered type when it constructs the entity. */
  readonly data: Json;
}

export interface PopulationRecord {
  readonly ruleId: TypeId;
  /** Active seconds remaining until the next attempt. */
  readonly secondsUntilAttempt: number;
  /** Advances on failed placement too, so restore cannot reroll an attempt. */
  readonly attempts: number;
}

export interface WorldSnapshot {
  /** Version of the data inside the local and cloud envelopes. */
  readonly schema: 1;
  readonly seed: number;
  readonly tick: Tick;
  readonly simSeconds: number;
  readonly gravity: Vec3;
  /** The next entity identity counter, retained after removals. */
  readonly nextEntity: number;
  readonly controlledActor: EntityId;
  /** Ground and tethered objects share this list. IDs appear once. */
  readonly entities: readonly EntityRecord[];
  readonly tethers: readonly Tether[];
  readonly populations: readonly PopulationRecord[];
  readonly marks: readonly Mark[];
}

/** Browser-only metadata kept outside the engine snapshot. */
export interface CheckpointPayload {
  readonly world: WorldSnapshot;
  /** Text retained for the existing interruption prompt. */
  readonly pending: Readonly<{ text: string; tool: string | null }> | null;
}

export type CheckpointError = 'empty' | 'malformed' | 'unsupported-format' | 'unknown-type';
export type DecodedCheckpoint =
  | Readonly<{ ok: true; checkpoint: CheckpointPayload }>
  | Readonly<{ ok: false; reason: CheckpointError }>;

export interface SnapshotCodec {
  /** Decode the world payload of local format 3 or 4 and cloud format 1 or 2. */
  decode(raw: unknown, wallNowMs: UnixMs): DecodedCheckpoint;
  /** Encode a versioned, JSON-safe payload. The storage layer owns its envelope. */
  encode(checkpoint: CheckpointPayload): Json;
}
