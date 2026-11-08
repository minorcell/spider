import { onLocalBusy } from '@/src/client/local/activity';
import { createLocalRuntime } from '@/src/client/local/runtime';
import { attachInferenceWorker, type InferenceScope } from '@/src/client/local/workerAttach';

onLocalBusy((busy) => self.postMessage({ event: 'localActivity', busy }));
attachInferenceWorker(self as unknown as InferenceScope, createLocalRuntime());
