import type { WorldRecord } from '@/src/shared/sim/snapshot';

export interface SnapshotStore {
  readSnapshot(): Promise<unknown>;
  putSnapshot(record: WorldRecord): Promise<void>;
  removeSnapshot(): Promise<void>;
  sweepSnapshots(today: string): Promise<void>;
}

export async function dbSnapshotStore(): Promise<SnapshotStore> {
  const { createDbRepository } = await import('@/src/client/storage/direct');
  return createDbRepository();
}
