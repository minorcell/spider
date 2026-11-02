import { Diary } from '../journal/diary.js';
import { dbSnapshotStore, type SnapshotStore } from '../journal/store.js';
import type { JournalRequest, JournalState } from './protocol.js';

export type Handler = (request: JournalRequest) => Promise<unknown>;

function stateOf(diary: Diary): JournalState {
  return {
    date: diary.date,
    session: diary.session,
    behind: diary.behind(),
    dismissed: diary.dismissed,
  };
}

/**
 * All journal and snapshot work runs here. The page only sends requests and
 * receives plain values; IndexedDB and the daily summary never touch its thread.
 */
export function createHandler(): Handler {
  let diary: Diary | null = null;
  let snapshots: SnapshotStore | null = null;

  // A worker can receive the next message while an earlier handler is
  // waiting on IndexedDB (or the summarizer). Diary is mutable, so allowing
  // those requests to overlap can lose a turn or return a stale state. Keep
  // each mutable resource ordered; snapshots do not have to wait for a long
  // model summary in the diary queue. Failed work must not block the next
  // request in the same queue.
  let diaryQueue = Promise.resolve();
  let snapshotQueue = Promise.resolve();

  const open = async (): Promise<Diary> => (diary ??= await Diary.open());
  const store = async (): Promise<SnapshotStore> => (snapshots ??= await dbSnapshotStore());

  const dispatch = async (request: JournalRequest): Promise<unknown> => {
    switch (request.method) {
      case 'open':
        return stateOf(await open());
      case 'save': {
        const opened = await open();
        await opened.save();
        return stateOf(opened);
      }
      case 'record': {
        const opened = await open();
        await opened.record(...request.args);
        return stateOf(opened);
      }
      case 'digest': {
        const opened = await open();
        await opened.digest(request.args[0]);
        return stateOf(opened);
      }
      case 'backfill': {
        const opened = await open();
        await opened.backfill(request.args[0]);
        return stateOf(opened);
      }
      case 'indexBlock':
        return (await open()).indexBlock();
      case 'pages':
        return (await open()).pages();
      case 'read':
        return (await open()).read(request.args[0]);
      case 'write':
        return (await open()).write(request.args[0]);
      case 'dismiss': {
        const opened = await open();
        opened.dismissed = request.args[0];
        return stateOf(opened);
      }
      case 'recordUsage': {
        const opened = await open();
        const [usage, now, meta] = request.args;
        await opened.recordUsage(usage, now == null ? undefined : new Date(now), meta);
        return null;
      }
      case 'recordUsageCall': {
        const opened = await open();
        await opened.recordUsageCall(request.args[0]);
        return null;
      }
      case 'recordUsageCalls': {
        const opened = await open();
        await opened.recordUsageCalls(request.args[0]);
        return null;
      }
      case 'readUsage':
        return (await open()).readUsage(request.args[0], request.args[1]);
      case 'snapshotRead':
        return (await store()).readSnapshot();
      case 'snapshotPut':
        await (await store()).putSnapshot(request.args[0]);
        return null;
      case 'snapshotRemove':
        await (await store()).removeSnapshot();
        return null;
      case 'snapshotSweep':
        await (await store()).sweepSnapshots(request.args[0]);
        return null;
    }
  };

  return (request) => {
    const snapshotsOnly = request.method.startsWith('snapshot');
    const task = (snapshotsOnly ? snapshotQueue : diaryQueue).then(() => dispatch(request));
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    if (snapshotsOnly) snapshotQueue = settled;
    else diaryQueue = settled;
    return task;
  };
}
