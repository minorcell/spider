import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbRepository } from '@/src/client/storage/direct';
import { openSpiderDb, resetSpiderDb } from '@/src/client/storage/db';
import { blankSession } from '@/src/client/journal/session';
import { captureBody, type WorldRecord } from '@/src/shared/sim/snapshot';
import { SimSession } from '@/src/shared/sim/session';
import { transact } from '@/src/client/storage/transaction';

export function snapshot(seq = 1): WorldRecord {
  return {
    ...captureBody(new SimSession(5), null),
    id: 'current',
    format: 3,
    savedAt: 1,
    day: '2026-11-02',
    owner: 'test',
    seq,
    leaseUntil: 99,
  };
}

beforeEach(resetSpiderDb);
afterEach(() => vi.restoreAllMocks());

describe('direct persistence repository', () => {
  it('migrates a session and archives its summary exactly once across concurrent readers', async () => {
    const db = await openSpiderDb();
    await db.put('sessions', {
      date: '2026-11-02',
      turns: [{ role: 'user', text: 'hello' }],
      summary: 'old',
      updatedAt: 1,
      digestedAt: 0,
    });
    const repository = createDbRepository();
    await repository.patchMemory({ date: '2026-11-02', summary: 'existing', noted: 'keep' });
    const [first, second] = await Promise.all([
      repository.loadSession('2026-11-02'),
      repository.loadSession('2026-11-02'),
    ]);
    expect(first).toEqual(second);
    expect(first?.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(await repository.getMemory('2026-11-02')).toMatchObject({
      summary: 'existing\nold',
      noted: 'keep',
    });
  });

  it('rolls back both migration writes when saving the migrated session fails', async () => {
    const db = await openSpiderDb();
    const legacy = { date: '2026-11-02', turns: [], summary: 'old', updatedAt: 1, digestedAt: 0 };
    await db.put('sessions', legacy);
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'sessions') throw new Error('session write failed');
      return put.call(this, value, key);
    });
    await expect(createDbRepository().loadSession(legacy.date)).rejects.toThrow(
      'session write failed',
    );
    spy.mockRestore();
    expect(await db.get('sessions', legacy.date)).toEqual(legacy);
    expect(await db.get('memories', legacy.date)).toBeUndefined();
  });

  it('merges concurrent partial patches atomically even through separate adapters', async () => {
    const first = createDbRepository();
    const second = createDbRepository();
    await Promise.all([
      first.patchMemory({ date: '2026-11-02', noted: 'explicit' }),
      second.patchMemory({ date: '2026-11-02', summary: 'digest' }),
      first.patchMemory({ date: '2026-11-02', description: 'line' }),
    ]);
    expect(await first.getMemory('2026-11-02')).toMatchObject({
      description: 'line',
      noted: 'explicit',
      summary: 'digest',
    });
    await second.patchMemory({ date: '2026-11-02', noted: '', description: '', summary: '' });
    expect(await first.getMemory('2026-11-02')).toMatchObject({
      description: '',
      noted: '',
      summary: '',
    });
  });

  it('orders memory pages and handles empty legacy summaries', async () => {
    const db = await openSpiderDb();
    const repository = createDbRepository();
    await db.put('sessions', {
      date: '2026-11-02',
      turns: [],
      summary: '',
      updatedAt: 1,
      digestedAt: 0,
    });
    expect(await repository.loadSession('2026-11-02')).toMatchObject({ messages: [] });
    expect(await repository.getMemory('2026-11-02')).toBeNull();
    await repository.patchMemory({ date: '2026-11-03' });
    await repository.patchMemory({ date: '2026-11-01' });
    expect((await repository.listMemories()).map((page) => page.date)).toEqual([
      '2026-11-01',
      '2026-11-03',
    ]);
    expect(await repository.loadSession('missing')).toBeUndefined();
    await repository.saveSession(blankSession('2026-11-04'));
    expect(await repository.loadSession('2026-11-04')).toEqual(blankSession('2026-11-04'));
  });

  it('keeps future and stale snapshots and atomically removes malformed rows', async () => {
    const repository = createDbRepository();
    const db = await openSpiderDb();
    expect(await repository.readSnapshot()).toBeNull();
    const saved = snapshot();
    await repository.putSnapshot(saved);
    await db.put('snapshots', { ...saved, id: 'old' } as unknown as WorldRecord);
    await repository.sweepSnapshots('2026-11-03');
    expect(await repository.readSnapshot()).toEqual(saved);
    expect(await db.get('snapshots', 'old')).toBeUndefined();
    const future = { id: 'current', format: 999 } as WorldRecord;
    await repository.putSnapshot(future);
    await repository.sweepSnapshots('2026-11-03');
    expect(await repository.readSnapshot()).toEqual(future);
    await repository.putSnapshot({ id: 'current', format: 0 } as WorldRecord);
    await repository.sweepSnapshots('2026-11-03');
    expect(await repository.readSnapshot()).toBeNull();
    await repository.putSnapshot(saved);
    await repository.removeSnapshot();
    expect(await repository.readSnapshot()).toBeNull();
  });
});

it('retains the original transaction error if abort itself fails', async () => {
  const tx = {
    done: Promise.resolve(),
    abort: vi.fn(() => {
      throw new Error('already aborted');
    }),
  };
  await expect(
    transact(tx, async () => {
      throw new Error('original');
    }),
  ).rejects.toThrow('original');
  expect(tx.abort).toHaveBeenCalledOnce();
});
