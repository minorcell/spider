import { attachWorldWorker, type WorldScope } from './worldAttach.js';

attachWorldWorker(self as unknown as WorldScope);
