import { useLocalBackend } from '../local/backend.js';
import { localRuntime } from '../local/runtime.js';
import { attachJournalWorker, type WorkerScope } from './attach.js';

useLocalBackend(localRuntime);
attachJournalWorker(self as unknown as WorkerScope);
