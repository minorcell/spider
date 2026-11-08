import { attachJournalWorker, type WorkerScope } from '@/src/client/worker/attach';

attachJournalWorker(self as unknown as WorkerScope);
