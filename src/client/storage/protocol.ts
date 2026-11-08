import type { PersistenceRepository } from '@/src/client/storage/repository';

export type StorageMethod = keyof PersistenceRepository;
export type StorageRequest = {
  [K in StorageMethod]: { id: number; method: K; args: Parameters<PersistenceRepository[K]> };
}[StorageMethod];
export type StorageReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };
export interface StorageConnection {
  event: 'storageConnect';
  port: MessagePort;
}
