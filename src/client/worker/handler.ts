import { Diary } from '@/src/client/journal/diary';
import type { PersistenceRepository } from '@/src/client/storage/repository';
import type { JournalRequest, JournalState } from '@/src/client/worker/protocol';

export type Handler = (request: JournalRequest) => Promise<unknown>;

function stateOf(diary: Diary): JournalState {
  return {
    date: diary.date,
    session: diary.session,
    behind: diary.behind(),
    dismissed: diary.dismissed,
  };
}

export function createHandler(repository: PersistenceRepository): Handler {
  let diary: Diary | null = null;

  let diaryQueue = Promise.resolve();

  const open = async (): Promise<Diary> => (diary ??= await Diary.open(new Date(), repository));
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
    }
  };

  return (request) => {
    const task = diaryQueue.then(() => dispatch(request));
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    diaryQueue = settled;
    return task;
  };
}
