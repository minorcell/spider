import type { WorldRecord } from '../../shared/sim/snapshot.js';

export interface SnapshotStore {
  readSnapshot(): Promise<unknown>;
  putSnapshot(record: WorldRecord): Promise<void>;
  removeSnapshot(): Promise<void>;
  sweepSnapshots(today: string): Promise<void>;
}

export async function dbSnapshotStore(): Promise<SnapshotStore> {
  const [{ openSpiderDb }, { classify }] = await Promise.all([
    import('./db.js'),
    import('../../shared/sim/snapshot.js'),
  ]);
  return {
    async readSnapshot() {
      const db = await openSpiderDb();
      return (await db.get('snapshots', 'current')) ?? null;
    },
    async putSnapshot(record) {
      const db = await openSpiderDb();
      await db.put('snapshots', record);
    },
    async removeSnapshot() {
      const db = await openSpiderDb();
      await db.delete('snapshots', 'current');
    },
    async sweepSnapshots(today) {
      const db = await openSpiderDb();
      const rows = await db.getAll('snapshots');
      for (const row of rows) {
        const status = classify(row, today).status;
        if (row.id !== 'current' || status === 'malformed') {
          await db.delete('snapshots', row.id);
        }
      }
    },
  };
}
