import type { UnixMs } from './base';
import type {
  CheckpointError,
  CheckpointPayload,
  SnapshotCodec,
  WorldSnapshot,
} from './module_Snapshot';
import type { World, WorldFrame, WorldRestoreResult } from './module_World';

export type BuildCandidate = (snapshot: WorldSnapshot) => WorldRestoreResult;

export type RestoreResult =
  | Readonly<{
      ok: true;
      world: World;
      frame: WorldFrame;
      pending: CheckpointPayload['pending'];
    }>
  | Readonly<{ ok: false; reason: CheckpointError }>;

/** 宿主确认恢复成功且具备写入权限后，才接管返回的世界。 */
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
