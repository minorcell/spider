import { useLocalBackend } from '../local/backend.js';
import { onLocalBusy } from '../local/activity.js';
import { localRuntime } from '../local/runtime.js';
import { attachJournalWorker, type WorkerScope } from './attach.js';

useLocalBackend(localRuntime);
onLocalBusy((busy) => self.postMessage({ event: 'localActivity', busy }));
attachJournalWorker(self as unknown as WorkerScope);
