import { useLocalBackend } from '@/src/client/local/backend';
import { onLocalBusy } from '@/src/client/local/activity';
import { localRuntime } from '@/src/client/local/runtime';
import { attachJournalWorker, type WorkerScope } from '@/src/client/worker/attach';

useLocalBackend(localRuntime);
onLocalBusy((busy) => self.postMessage({ event: 'localActivity', busy }));
attachJournalWorker(self as unknown as WorkerScope);
