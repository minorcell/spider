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

  const open = async (): Promise<Diary> => (diary ??= await Diary.open());
  const store = async (): Promise<SnapshotStore> => (snapshots ??= await dbSnapshotStore());

  return async (request) => {
    switch (request.method) {
      case 'open':
      case 'state':
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
      case 'listLines':
        return (await open()).listLines();
      case 'dismiss': {
        const opened = await open();
        opened.dismissed = request.args[0];
        return stateOf(opened);
      }
      case 'recordUsage': {
        const opened = await open();
        const [usage, now] = request.args;
        await opened.recordUsage(usage, now == null ? undefined : new Date(now));
        return stateOf(opened);
      }
      case 'readUsage':
        return (await open()).readUsage(request.args[0]);
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
}
