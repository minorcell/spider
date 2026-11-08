import { MessageChannel } from 'node:worker_threads';
import { afterAll, describe, expect, test } from 'vitest';
import { StorageClient, type StorageClientPort } from '@/src/client/storage/client';
import { createDbRepository } from '@/src/client/storage/direct';
import {
  attachStoragePort,
  createStorageHandler,
  type StorageServerPort,
} from '@/src/client/storage/handler';
import { captureBody, type WorldRecord } from '@/src/shared/sim/snapshot';
import { SimSession } from '@/src/shared/sim/session';

const repository = createDbRepository();
const channel = new MessageChannel();
attachStoragePort(channel.port1 as unknown as StorageServerPort, createStorageHandler(repository));
const client = new StorageClient(channel.port2 as unknown as StorageClientPort);
const saved: WorldRecord = {
  ...captureBody(new SimSession(5), null),
  id: 'current',
  format: 3,
  savedAt: 1,
  day: '2026-11-09',
  owner: 'benchmark',
  seq: 1,
  leaseUntil: 99,
};

afterAll(() => {
  client.close();
  channel.port1.close();
  channel.port2.close();
});

describe('storage persistence and MessagePort overhead (fake IndexedDB, no browser Worker)', () => {
  for (const [name, store] of [
    ['direct', repository],
    ['MessagePort', client],
  ] as const) {
    test(`${name} memory patch and read`, async ({ bench }) => {
      const patch = { date: '2026-11-09', noted: '保留用户明确记下的内容。'.repeat(40) };
      await store.patchMemory(patch);
      expect(await store.getMemory(patch.date)).toMatchObject(patch);
      await bench(`${name} memory patch + read`, async () => {
        await store.patchMemory(patch);
        await store.getMemory(patch.date);
      }).run();
    });

    test(`${name} complete world snapshot write and read`, async ({ bench }) => {
      await store.putSnapshot(saved);
      expect(await store.readSnapshot()).toEqual(saved);
      await bench(`${name} snapshot write + read`, async () => {
        await store.putSnapshot(saved);
        await store.readSnapshot();
      }).run();
    });
  }
});
