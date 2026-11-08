import { createDbRepository } from '@/src/client/storage/direct';
import { attachStoragePort, createStorageHandler } from '@/src/client/storage/handler';
import type { StorageConnection } from '@/src/client/storage/protocol';

const handle = createStorageHandler(createDbRepository());
self.onmessage = (event: MessageEvent<StorageConnection>) => {
  if (event.data.event === 'storageConnect') attachStoragePort(event.data.port, handle);
};
