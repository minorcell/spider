import { transact } from '@/src/client/storage/transaction';
import { blankMemory, openSpiderDb } from '@/src/client/storage/db';
import { restoreSession } from '@/src/client/journal/session';
import { readUsage, recordUsageCalls, usageCallFromUsage } from '@/src/client/journal/usage';
import { classify } from '@/src/shared/sim/snapshot';
import type { PersistenceRepository } from '@/src/client/storage/repository';

/** Used inside the storage Worker, or directly when Workers are unavailable. */
export function createDbRepository(): PersistenceRepository {
  return {
    async loadSession(date) {
      const db = await openSpiderDb();
      const tx = db.transaction(['sessions', 'memories'], 'readwrite');
      return transact(tx, async () => {
        const stored = await tx.objectStore('sessions').get(date);
        if (!stored || 'messages' in stored) {
          return stored;
        }
        const session = restoreSession(stored);
        // Archive once, in the same transaction that replaces the legacy session.
        if (stored.summary) {
          const page = (await tx.objectStore('memories').get(date)) ?? blankMemory(date);
          await tx.objectStore('memories').put({
            ...page,
            summary: [page.summary, stored.summary].filter(Boolean).join('\n'),
            updatedAt: Date.now(),
          });
        }
        await tx.objectStore('sessions').put(session);
        return session;
      });
    },
    async saveSession(session) {
      const db = await openSpiderDb();
      await db.put('sessions', session);
    },
    async listMemories() {
      const db = await openSpiderDb();
      return (await db.getAll('memories')).toSorted((a, b) => a.date.localeCompare(b.date));
    },
    async getMemory(date) {
      const db = await openSpiderDb();
      return (await db.get('memories', date)) ?? null;
    },
    async patchMemory(patch) {
      const db = await openSpiderDb();
      const tx = db.transaction('memories', 'readwrite');
      return transact(tx, async () => {
        const current = (await tx.store.get(patch.date)) ?? blankMemory(patch.date);
        const next = {
          date: patch.date,
          description: patch.description ?? current.description,
          noted: patch.noted ?? current.noted,
          summary: patch.summary ?? current.summary,
          updatedAt: Date.now(),
        };
        await tx.store.put(next);
        return next;
      });
    },
    async recordUsage(usage, now = new Date(), meta) {
      const call = usageCallFromUsage(usage, now, meta);
      if (call) await recordUsageCalls([call]);
    },
    recordUsageCall: (call) => recordUsageCalls([call]),
    recordUsageCalls,
    readUsage,
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
      const tx = db.transaction('snapshots', 'readwrite');
      return transact(tx, async () => {
        for (const row of await tx.store.getAll()) {
          if (row.id !== 'current' || classify(row, today).status === 'malformed') {
            await tx.store.delete(row.id);
          }
        }
      });
    },
  };
}
