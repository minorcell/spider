import { attachWorldWorker, type WorldScope } from '@/src/client/worker/worldAttach';

attachWorldWorker(self as unknown as WorldScope);
