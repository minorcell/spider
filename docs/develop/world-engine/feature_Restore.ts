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
  /** 只有早期苹果生命周期原型保存过这个字段。 */
  readonly expiresAt?: UnixMs;
}

/** 输入已通过旧版格式校验。 */
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
    // 旧版苹果共三口，已经吃掉一口或两口时，分别换算为六口中的两口或四口。
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
