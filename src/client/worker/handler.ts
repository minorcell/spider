import { Diary } from '../journal/diary.js';
import { dbSnapshotStore, type SnapshotStore } from '../journal/store.js';
import type { JournalRequest, JournalState } from './protocol.js';

export type Handler = (
  request: JournalRequest,
  onDelta?: (text: string) => void,
) => Promise<unknown>;

function stateOf(diary: Diary): JournalState {
  return {
    date: diary.date,
    session: diary.session,
    behind: diary.behind(),
    dismissed: diary.dismissed,
  };
}

export function createHandler(): Handler {
  let diary: Promise<Diary> | null = null;
  let snapshots: SnapshotStore | null = null;

  const queues = {
    diary: Promise.resolve(),
    memory: Promise.resolve(),
    snapshot: Promise.resolve(),
  };

  const open = (): Promise<Diary> =>
    (diary ??= Diary.open().catch((error) => {
      diary = null;
      throw error;
    }));
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

  return (request, onDelta) => {
    if (request.method.startsWith('local'))
      return import('../local/runtime.js').then<unknown>(({ localRuntime }) => {
        switch (request.method) {
          case 'localSession':
            return localRuntime.localSession!(...request.args);
          case 'localLoad':
            return localRuntime.localLoad();
          case 'localStatus':
            return localRuntime.localStatus();
          case 'localUnload':
            return localRuntime.localUnload();
          case 'localComplete':
            return localRuntime.localComplete(
              request.args[0],
              request.args[1],
              request.args[2],
              onDelta,
            );
          case 'localCancel':
            return localRuntime.localCancel(...request.args);
        }
      });
    // Memory tools must stay available while a background summary yields to an action.
    const queue = request.method.startsWith('snapshot')
      ? 'snapshot'
      : ['indexBlock', 'pages', 'read', 'write'].includes(request.method)
        ? 'memory'
        : 'diary';
    const task = queues[queue].then(() => dispatch(request));
    queues[queue] = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
}
