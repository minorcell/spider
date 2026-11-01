import { attachJournalWorker, type WorkerScope } from './attach.js';

attachJournalWorker(self as unknown as WorkerScope);
