import type { UnixMs } from './base';
import type { Deadline } from './module_Content';
import type { DroppedItemData } from './module_Entity';
import type {
  CheckpointError,
  CheckpointPayload,
  SnapshotCodec,
  WorldSnapshot,
} from './module_Snapshot';
import type { World, WorldFrame, WorldRestoreResult } from './module_World';

interface LegacyApple {
  readonly stage: number;
  /** Present only in snapshots produced by the earlier apple-lifecycle prototype. */
  readonly expiresAt?: UnixMs;
}

/** The inputs have already passed legacy format validation. */
export function restoreApple(
  item: LegacyApple,
  ordinal: number,
  wallNowMs: UnixMs,
): DroppedItemData {
  const legacy = item.expiresAt === undefined;
  const expiresAtMs = item.expiresAt ?? wallNowMs + (720 - (ordinal % 20) * 24) * 1000;
  const deadline: Deadline = { clock: 'wall', rotsAtMs: expiresAtMs - 90_000, expiresAtMs };
  return {
    itemTypeId: 'spider:apple',
    // A 3-bite apple with 1 or 2 completed bites maps to 2 or 4 out of 6.
    completedBites: Math.min(5, Math.floor(item.stage) * (legacy ? 2 : 1)),
    deadline,
  };
}

export type BuildCandidate = (snapshot: WorldSnapshot) => WorldRestoreResult;

export type RestoreResult =
  | Readonly<{
      ok: true;
      world: World;
      frame: WorldFrame;
      pending: CheckpointPayload['pending'];
    }>
  | Readonly<{ ok: false; reason: CheckpointError }>;

/** The host installs the returned world only on success, after checking write authority. */
export function restoreCandidate(
  raw: unknown,
  wallNowMs: UnixMs,
  codec: SnapshotCodec,
  build: BuildCandidate,
): RestoreResult {
  const decoded = codec.decode(raw, wallNowMs);
  if (!decoded.ok) return decoded;
  const candidate = build(decoded.checkpoint.world);
  if (!candidate.ok) return candidate;
  const { world } = candidate;
  const frame = world.reconcileWallTime(wallNowMs);
  return { ok: true, world, frame, pending: decoded.checkpoint.pending };
}
