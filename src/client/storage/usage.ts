import { transact } from '@/src/client/storage/transaction';
import { openSpiderDb } from '@/src/client/storage/db';
import {
  aggregateDay,
  groupCalls,
  normalizeCall,
  usageSnapshot,
  type UsageCall,
  type UsageRange,
  type UsageSnapshot,
} from '@/src/client/journal/usage';
import { shiftDate } from '@/src/shared/dates';

export async function writeUsageCalls(calls: UsageCall[]): Promise<void> {
  if (calls.length === 0) return;
  const next = calls.map(normalizeCall);
  // Usage is best effort: a ledger failure must not discard a completed summary.
  try {
    const db = await openSpiderDb();
    const tx = db.transaction(['usageCalls', 'usage'], 'readwrite');
    await transact(tx, async () => {
      const callStore = tx.objectStore('usageCalls');
      const dayStore = tx.objectStore('usage');
      for (const [date, batch] of groupCalls(next)) {
        const stored = new Map<string, UsageCall>();
        for (const row of await callStore.index('date').getAll(date)) {
          const call = normalizeCall(row);
          stored.set(call.id, call);
        }
        for (const call of batch) {
          stored.set(call.id, call);
          await callStore.put(call);
        }
        await dayStore.put(aggregateDay(date, [...stored.values()]));
      }
    });
  } catch {}
}

export async function loadUsage(today: string, range: UsageRange = 'all'): Promise<UsageSnapshot> {
  const db = await openSpiderDb();
  const span = range === '7' ? 7 : range === '30' ? 30 : 0;
  const from = span === 0 ? null : shiftDate(today, 1 - span * 2);
  const tx = db.transaction(['usage', 'usageCalls']);
  const [days, calls] = await Promise.all([
    tx.objectStore('usage').getAll(from == null ? undefined : IDBKeyRange.bound(from, today)),
    from == null
      ? tx.objectStore('usageCalls').getAll()
      : tx.objectStore('usageCalls').index('date').getAll(IDBKeyRange.bound(from, today)),
  ]);
  await tx.done;
  return usageSnapshot(today, range, days, calls);
}
