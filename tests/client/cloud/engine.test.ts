import { beforeEach, describe, expect, it } from 'vitest';
import { bundleBytes, type CloudBundle } from '../../../src/client/cloud/bundle.js';
import { canonicalBytes, progressHash } from '../../../src/client/cloud/bytes.js';
import {
  blankEngine,
  chooseLocal,
  chooseRemote,
  keepalive,
  LEASE_KEY,
  reconcile,
  renewLease,
  takeOver,
  WORLD_KEY,
  type CloudCursor,
  type CloudIo,
  type Engine,
} from '../../../src/client/cloud/engine.js';
import type { ObjectMatch, ObjectResult } from '../../../src/client/cloud/s3.js';
import type { CloudSettings } from '../../../src/client/cloud/settings.js';
import { captureBody } from '../../../src/shared/sim/snapshot.js';
import { SimSession } from '../../../src/shared/sim/session.js';

const NOW = 1_000_000;

const readySettings: CloudSettings = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'spider',
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  ready: true,
};

function sample(deviceId = 'device-a', seed = 4): CloudBundle {
  return {
    format: 1,
    deviceId,
    world: captureBody(new SimSession(seed), null),
    memories: [
      { date: '2026-11-06', description: '水边', noted: '叫水边', summary: '记住了', updatedAt: 5 },
    ],
  };
}

function http(
  status: number,
  etag: string | null = null,
  body: Uint8Array | null = null,
): ObjectResult {
  return { status, etag, body };
}

function leaseBytes(deviceId: string, until: number): Uint8Array {
  return canonicalBytes({ deviceId, until });
}

interface Harness {
  io: CloudIo;
  engine: Engine;
  gets: string[];
  puts: Array<{ key: string; match: ObjectMatch }>;
  kept: Array<{ key: string; match: ObjectMatch }>;
  adopted: CloudBundle | null;
  settings: CloudSettings;
  local: CloudBundle | null;
  adoptOk: boolean;
}

function harness(): Harness {
  const state: Harness = {
    io: {} as CloudIo,
    engine: blankEngine(),
    gets: [],
    puts: [],
    kept: [],
    adopted: null,
    settings: { ...readySettings },
    local: null,
    adoptOk: true,
  };
  const gets: ObjectResult[] = [];
  const puts: ObjectResult[] = [];
  state.io = {
    now: () => NOW,
    settings: () => state.settings,
    readCursor: async () => {
      state.engine.cursor ??= {
        id: 'current',
        deviceId: 'device-a',
        basisEtag: null,
        uploadedHash: null,
        leaseEtag: null,
      };
      return state.engine.cursor;
    },
    writeCursor: async (cursor) => {
      state.engine.cursor = cursor;
    },
    readLocal: async () => state.local,
    adopt: async (bundle) => {
      if (!state.adoptOk) return false;
      state.adopted = bundle;
      state.local = bundle;
      return true;
    },
    get: async (key) => {
      state.gets.push(key);
      return gets.shift() ?? http(404);
    },
    put: async (key, _body, match) => {
      state.puts.push({ key, match });
      return puts.shift() ?? http(200, '"next"');
    },
    keepalive: (key, _body, match) => {
      state.kept.push({ key, match });
    },
  };
  return Object.assign(state, {
    queueGet(...items: ObjectResult[]) {
      gets.push(...items);
    },
    queuePut(...items: ObjectResult[]) {
      puts.push(...items);
    },
  });
}

type Scripted = Harness & {
  queueGet(...items: ObjectResult[]): void;
  queuePut(...items: ObjectResult[]): void;
};

function scripted(): Scripted {
  return harness() as Scripted;
}

function cursor(over: Partial<CloudCursor> = {}): CloudCursor {
  return {
    id: 'current',
    deviceId: 'device-a',
    basisEtag: null,
    uploadedHash: null,
    leaseEtag: null,
    ...over,
  };
}

describe('reconcile', () => {
  let box: Scripted;

  beforeEach(() => {
    box = scripted();
  });

  it('turns off and drops a pending choice when cloud is not ready', async () => {
    box.settings = { ...readySettings, ready: false };
    box.engine.choice = { local: sample(), remote: sample('other'), remoteEtag: '"r"' };
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'off' });
    expect(box.engine.choice).toBeNull();
  });

  it('leaves the phase alone when the endpoint cannot be reached', async () => {
    box.engine.phase = { kind: 'ready' };
    box.queueGet(http(0));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
  });

  it('stops when the key is rejected', async () => {
    box.engine.choice = { local: sample(), remote: sample('other'), remoteEtag: '"r"' };
    box.queueGet(http(403));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });
    expect(box.engine.choice).toBeNull();
  });

  it('becomes ready when neither side has a world', async () => {
    box.queueGet(http(404));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
    expect(box.puts).toHaveLength(0);
  });

  it('creates the cloud world from this computer', async () => {
    box.local = sample();
    box.queueGet(http(404), http(404));
    box.queuePut(http(200, '"world"'), http(200, '"lease"'));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
    expect(box.puts[0]).toEqual({ key: WORLD_KEY, match: { kind: 'if-none-match' } });
    expect(box.engine.cursor).toMatchObject({ basisEtag: '"world"', leaseEtag: '"lease"' });
  });

  it('retries a lost create once and then reports the collision', async () => {
    box.local = sample();
    box.queueGet(http(404), http(404));
    box.queuePut(http(412), http(412));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档正在被另一台电脑写入' });
  });

  it('stops a create the endpoint refused', async () => {
    box.local = sample();
    box.engine.phase = { kind: 'ready' };
    box.queueGet(http(404));
    box.queuePut(http(500), http(200, null));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
    box.engine.phase = { kind: 'ready' };
    box.queueGet(http(404));
    await reconcile(box.io, box.engine);
    expect(box.puts.at(-1)?.match).toEqual({ kind: 'if-none-match' });
  });

  it('reports an unreadable world, a missing etag, and a bad bundle', async () => {
    box.queueGet(http(500));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档读不出来' });

    box.queueGet(http(200, null, bundleBytes(sample())));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '端点没有返回可用的 ETag' });

    box.queueGet(http(200, '"v"', new TextEncoder().encode('{')));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档读不出来' });
  });

  it('adopts a cloud world this browser has never saved', async () => {
    const remote = sample('cloud-device', 8);
    box.queueGet(http(200, '"v"', bundleBytes(remote)), http(404));
    box.queuePut(http(200, '"lease"'));
    await reconcile(box.io, box.engine);
    expect(box.adopted?.world.seed).toBe(8);
    expect(box.engine.adopted).toBe(true);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
    expect(box.engine.cursor?.basisEtag).toBe('"v"');
  });

  it('does not adopt a cloud world the page cannot apply', async () => {
    box.adoptOk = false;
    box.queueGet(http(200, '"v"', bundleBytes(sample('cloud-device', 8))));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档读不出来' });
    expect(box.engine.adopted).toBe(false);
  });

  it('asks when both sides already have a world and this browser has no basis', async () => {
    box.local = sample('device-a', 3);
    box.queueGet(http(200, '"v"', bundleBytes(sample('other', 9))));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'choose' });
    expect(box.puts).toHaveLength(0);
    expect(box.engine.choice?.remoteEtag).toBe('"v"');
  });

  it('only refreshes the lease when the cloud copy is the one already uploaded', async () => {
    const saved = sample();
    box.local = null;
    box.engine.cursor = cursor({ basisEtag: '"v"', uploadedHash: 'stored' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(404));
    box.queuePut(http(200, '"lease"'));
    await reconcile(box.io, box.engine);
    expect(box.puts.map((put) => put.key)).toEqual([LEASE_KEY]);

    box.local = saved;
    box.engine.cursor = cursor({
      basisEtag: '"v"',
      uploadedHash: await progressHash(saved.world, saved.memories),
    });
    box.queueGet(
      http(200, '"v"', bundleBytes(saved)),
      http(200, '"old"', leaseBytes('device-a', NOW + 10)),
    );
    box.queuePut(http(200, '"lease2"'));
    await reconcile(box.io, box.engine);
    expect(box.puts.at(-1)?.match).toEqual({ kind: 'if-match', etag: '"old"' });
    expect(box.engine.phase).toEqual({ kind: 'ready' });
  });

  it('refuses a local upload when reading the lease is rejected', async () => {
    const saved = sample('device-a', 3);
    box.local = saved;
    box.engine.cursor = cursor({ basisEtag: '"v"', uploadedHash: 'old' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(403));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });
    expect(box.puts).toHaveLength(0);
  });

  it('asks instead of uploading while another computer still holds the lease', async () => {
    const saved = sample('device-a', 3);
    box.local = saved;
    box.engine.cursor = cursor({ basisEtag: '"v"', uploadedHash: 'old' });
    box.queueGet(
      http(200, '"v"', bundleBytes(sample('other', 9))),
      http(200, '"lease"', leaseBytes('other', NOW + 50)),
    );
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'choose' });
    expect(box.puts).toHaveLength(0);
  });

  it('uploads a local change when the lease is ours, expired, or unreadable', async () => {
    const saved = sample('device-a', 3);
    box.local = saved;
    const cases = [
      http(200, '"lease"', leaseBytes('device-a', NOW + 50)),
      http(200, '"lease"', leaseBytes('other', NOW - 5)),
      http(200, '"lease"', new TextEncoder().encode('{')),
      http(404),
    ];
    for (const lease of cases) {
      box.puts.length = 0;
      box.engine.cursor = cursor({ basisEtag: '"v"', uploadedHash: 'old' });
      box.engine.phase = { kind: 'ready' };
      box.queueGet(http(200, '"v"', bundleBytes(saved)), lease, http(404));
      box.queuePut(http(200, '"world"'), http(200, '"next-lease"'));
      await reconcile(box.io, box.engine);
      expect(box.puts[0]).toEqual({ key: WORLD_KEY, match: { kind: 'if-match', etag: '"v"' } });
      expect(box.engine.phase).toEqual({ kind: 'ready' });
    }
  });

  it('stops or retries when the conditional upload loses', async () => {
    const saved = sample('device-a', 3);
    box.local = saved;
    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"v"', uploadedHash: 'old' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(404));
    box.queuePut(http(403));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });

    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"v"', uploadedHash: 'old' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(404));
    box.queuePut(http(500));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });

    box.engine.cursor = cursor({ basisEtag: '"v"', uploadedHash: 'old' });
    box.queueGet(
      http(200, '"v"', bundleBytes(saved)),
      http(404),
      http(200, '"v"', bundleBytes(saved)),
      http(404),
    );
    box.queuePut(http(412), http(412));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档正在被另一台电脑写入' });
  });

  it('reports when a newer cloud copy cannot be applied', async () => {
    box.adoptOk = false;
    box.local = null;
    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"old"', uploadedHash: 'stored' });
    box.queueGet(http(200, '"new"', bundleBytes(sample('other', 11))));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档读不出来' });
    expect(box.adopted).toBeNull();
  });

  it('follows a cloud copy this computer did not change', async () => {
    const remote = sample('other', 11);
    box.engine.cursor = cursor({ basisEtag: '"old"', uploadedHash: 'stored' });
    box.queueGet(http(200, '"new"', bundleBytes(remote)), http(404));
    box.queuePut(http(200, '"lease"'));
    await reconcile(box.io, box.engine);
    expect(box.adopted?.world.seed).toBe(11);
    expect(box.engine.cursor?.basisEtag).toBe('"new"');
    expect(box.engine.phase).toEqual({ kind: 'ready' });
  });

  it('keeps a local copy whose bytes already match the new cloud object', async () => {
    const saved = sample('device-a', 6);
    const hash = await progressHash(saved.world, saved.memories);
    box.local = saved;
    box.engine.cursor = cursor({ basisEtag: '"old"', uploadedHash: hash });
    box.queueGet(http(200, '"new"', bundleBytes(saved)), http(200, null));
    box.queuePut(http(200, '"lease"'));
    await reconcile(box.io, box.engine);
    expect(box.adopted).toBeNull();
    expect(box.engine.cursor).toMatchObject({ basisEtag: '"new"', uploadedHash: hash });
    expect(box.puts[0].match).toEqual({ kind: 'if-none-match' });
  });

  it('parks the local world and adopts the cloud one when both changed', async () => {
    box.local = sample('a/b c', 3);
    const remote = sample('other', 12);
    box.engine.cursor = cursor({ basisEtag: '"old"', uploadedHash: 'stored' });
    box.queueGet(http(200, '"new"', bundleBytes(remote)), http(404));
    box.queuePut(http(200, '"parked"'), http(200, '"lease"'));
    await reconcile(box.io, box.engine);
    expect(box.puts[0].key).toBe(`spider/conflicts/a_b_c/${NOW}.json`);
    expect(box.engine.phase).toEqual({ kind: 'choose' });
    expect(box.adopted?.world.seed).toBe(12);
    expect(box.engine.choice?.remoteEtag).toBe('"new"');
  });

  it('does not adopt when the conflict copy cannot be saved', async () => {
    box.local = sample('device-a', 3);
    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"old"', uploadedHash: 'stored' });
    box.queueGet(http(200, '"new"', bundleBytes(sample('other', 12))));
    box.queuePut(http(500));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
    expect(box.adopted).toBeNull();

    box.adoptOk = false;
    box.engine.cursor = cursor({ basisEtag: '"old"', uploadedHash: 'stored' });
    box.queueGet(http(200, '"new"', bundleBytes(sample('other', 12))));
    box.queuePut(http(200, '"parked"'));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档读不出来' });
  });

  it('refuses the lease when the key is rejected or the network drops', async () => {
    const saved = sample();
    box.local = null;
    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(0));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase.kind).not.toBe('locked');

    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(403));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });
  });

  it('locks when another device holds the lease, including after a lost race', async () => {
    const saved = sample();
    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(
      http(200, '"v"', bundleBytes(saved)),
      http(200, '"lease"', leaseBytes('other', NOW + 80)),
    );
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'locked', until: NOW + 80 });

    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(404));
    box.queuePut(http(403));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });

    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(404));
    box.queuePut(http(500));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });

    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(
      http(200, '"v"', bundleBytes(saved)),
      http(200, null, leaseBytes('device-a', NOW)),
    );
    box.queuePut(http(200, null));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });

    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(
      http(200, '"v"', bundleBytes(saved)),
      http(404),
      http(200, '"again"', leaseBytes('other', NOW + 9)),
    );
    box.queuePut(http(412));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'locked', until: NOW + 9 });

    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(
      http(200, '"v"', bundleBytes(saved)),
      http(404),
      http(200, '"again"', new TextEncoder().encode('{')),
    );
    box.queuePut(http(412));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });

    box.engine.phase = { kind: 'ready' };
    box.engine.cursor = cursor({ basisEtag: '"v"' });
    box.queueGet(http(200, '"v"', bundleBytes(saved)), http(404), http(500));
    box.queuePut(http(412));
    await reconcile(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
  });
});

describe('choices and takeover', () => {
  let box: Scripted;

  beforeEach(() => {
    box = scripted();
  });

  it('does nothing without a choice or a cursor', async () => {
    await chooseLocal(box.io, box.engine);
    await chooseRemote(box.io, box.engine);
    box.engine.choice = { local: sample(), remote: sample('other'), remoteEtag: '"r"' };
    await chooseLocal(box.io, box.engine);
    expect(box.puts).toHaveLength(0);
    await chooseRemote(box.io, box.engine);
    expect(box.puts).toHaveLength(0);
  });

  it('keeps the choice when the parked copy does not land', async () => {
    const remote = sample('other', 2);
    box.engine.cursor = cursor();
    box.engine.choice = { local: sample(), remote, remoteEtag: '"r"' };
    box.queuePut(http(500));
    await chooseLocal(box.io, box.engine);
    expect(box.engine.choice?.remoteEtag).toBe('"r"');
    box.queuePut(http(500));
    await chooseRemote(box.io, box.engine);
    expect(box.engine.choice?.remoteEtag).toBe('"r"');
  });

  it('uploads this computer after parking the cloud copy', async () => {
    const remote = sample('other', 2);
    const local = sample('device-a', 3);
    box.engine.cursor = cursor();
    box.engine.choice = { local, remote, remoteEtag: '"r"' };
    box.queueGet(http(404));
    box.queuePut(http(200, '"park"'), http(200, '"world"'), http(200, '"lease"'));
    await chooseLocal(box.io, box.engine);
    expect(box.puts[1]).toEqual({ key: WORLD_KEY, match: { kind: 'if-match', etag: '"r"' } });
    expect(box.engine.phase).toEqual({ kind: 'ready' });
    expect(box.engine.choice).toBeNull();
  });

  it('reconciles again when the chosen upload loses the race', async () => {
    box.engine.cursor = cursor();
    box.engine.choice = { local: sample(), remote: sample('other'), remoteEtag: '"r"' };
    box.queueGet(http(0));
    box.queuePut(http(200, '"park"'), http(412));
    await chooseLocal(box.io, box.engine);
    expect(box.gets.at(-1)).toBe(WORLD_KEY);

    box.engine.cursor = cursor();
    box.engine.choice = { local: sample(), remote: sample('other'), remoteEtag: '"r"' };
    box.queuePut(http(200, '"park"'), http(403));
    await chooseLocal(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });
  });

  it('adopts the cloud copy and parks this computer', async () => {
    const remote = sample('other', 9);
    box.engine.cursor = cursor();
    box.engine.choice = { local: sample('device-a', 2), remote, remoteEtag: '"r"' };
    box.queueGet(http(404));
    box.queuePut(http(200, '"park"'), http(200, '"lease"'));
    await chooseRemote(box.io, box.engine);
    expect(box.adopted?.world.seed).toBe(9);
    expect(box.engine.cursor?.basisEtag).toBe('"r"');
    expect(box.engine.phase).toEqual({ kind: 'ready' });
    expect(box.puts.some((put) => put.key === WORLD_KEY)).toBe(false);
  });

  it('stops adopting the cloud copy when the page rejects it', async () => {
    box.adoptOk = false;
    box.engine.cursor = cursor();
    box.engine.choice = { local: sample(), remote: sample('other', 9), remoteEtag: '"r"' };
    box.queuePut(http(200, '"park"'));
    await chooseRemote(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档读不出来' });
  });

  it('does not take over unless this computer is locked and has a cursor', async () => {
    await takeOver(box.io, box.engine);
    box.engine.cursor = cursor();
    box.engine.phase = { kind: 'ready' };
    await takeOver(box.io, box.engine);
    expect(box.gets).toHaveLength(0);
  });

  it('parks a dirty local world, or skips that when the bytes already match', async () => {
    const saved = sample();
    const hash = await progressHash(saved.world, saved.memories);
    box.local = saved;
    box.engine.cursor = cursor({ uploadedHash: hash });
    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(http(403));
    await takeOver(box.io, box.engine);
    expect(box.puts).toHaveLength(0);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });

    box.local = null;
    box.engine.cursor = cursor();
    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(http(500));
    await takeOver(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'locked', until: NOW });

    box.engine.cursor = cursor();
    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(http(200, null));
    await takeOver(box.io, box.engine);
    expect(box.puts).toHaveLength(0);
  });

  it('stays locked when the lease write loses, and denies a bad key', async () => {
    box.engine.cursor = cursor();
    box.engine.phase = { kind: 'locked', until: NOW + 4 };
    box.queueGet(http(200, '"lease"', leaseBytes('other', NOW + 30)));
    box.queuePut(http(412));
    await takeOver(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'locked', until: NOW + 30 });

    box.engine.phase = { kind: 'locked', until: NOW + 4 };
    box.queueGet(http(200, '"lease"', new TextEncoder().encode('{')));
    box.queuePut(http(412));
    await takeOver(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'locked', until: NOW });

    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(http(200, '"lease"', leaseBytes('other', NOW + 1)));
    box.queuePut(http(403));
    await takeOver(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端密钥被拒绝' });

    box.engine.phase = { kind: 'locked', until: NOW };
    box.engine.cursor = cursor();
    box.queueGet(http(200, '"lease"', leaseBytes('other', NOW + 1)));
    box.queuePut(http(500), http(200, null));
    await takeOver(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'locked', until: NOW });
  });

  it('adopts the cloud world after the lease moves here', async () => {
    const remote = sample('other', 15);
    box.local = sample('device-a', 1);
    box.engine.cursor = cursor({ uploadedHash: 'dirty' });
    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(
      http(200, '"lease"', leaseBytes('other', NOW + 1)),
      http(200, '"world"', bundleBytes(remote)),
      http(200, '"world"', bundleBytes(remote)),
      http(404),
    );
    box.queuePut(http(200, '"park"'), http(200, '"ours"'), http(200, '"lease2"'));
    await takeOver(box.io, box.engine);
    expect(box.adopted?.world.seed).toBe(15);
    expect(box.engine.cursor?.basisEtag).toBe('"world"');
    expect(box.puts.some((put) => put.key === LEASE_KEY)).toBe(true);
  });

  it('still reconciles when the world read after takeover is not usable', async () => {
    box.engine.cursor = cursor();
    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(http(200, '"lease"'), http(404), http(404));
    box.queuePut(http(200, '"ours"'));
    await takeOver(box.io, box.engine);
    expect(box.adopted).toBeNull();

    box.engine.cursor = cursor({ leaseEtag: '"ours"' });
    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(http(200, '"lease"'), http(200, null, bundleBytes(sample('other', 4))));
    box.queuePut(http(200, '"ours"'));
    await takeOver(box.io, box.engine);
    expect(box.adopted).toBeNull();

    box.adoptOk = false;
    box.engine.cursor = cursor();
    box.engine.phase = { kind: 'locked', until: NOW };
    box.queueGet(http(200, '"lease"'), http(200, '"world"', bundleBytes(sample('other', 4))));
    box.queuePut(http(200, '"ours"'));
    await takeOver(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'error', message: '云端存档读不出来' });
  });

  it('gives up the takeover when the dirty local copy cannot be parked', async () => {
    box.local = sample();
    box.engine.cursor = cursor({ uploadedHash: 'dirty' });
    box.engine.phase = { kind: 'locked', until: NOW + 3 };
    box.queuePut(http(500));
    await takeOver(box.io, box.engine);
    expect(box.engine.phase).toEqual({ kind: 'locked', until: NOW + 3 });
    expect(box.gets).toHaveLength(0);
  });
});

describe('lease refresh and keepalive', () => {
  let box: Scripted;

  beforeEach(() => {
    box = scripted();
  });

  it('refreshes only a ready cursor', async () => {
    await renewLease(box.io, box.engine);
    box.engine.phase = { kind: 'ready' };
    await renewLease(box.io, box.engine);
    box.settings = { ...readySettings, ready: false };
    box.engine.cursor = cursor();
    await renewLease(box.io, box.engine);
    expect(box.gets).toHaveLength(0);

    box.settings = { ...readySettings };
    box.engine.phase = { kind: 'locked', until: NOW };
    box.engine.cursor = cursor();
    await renewLease(box.io, box.engine);
    expect(box.gets).toHaveLength(0);

    box.engine.phase = { kind: 'ready' };
    box.queueGet(http(404));
    box.queuePut(http(200, '"lease"'));
    await renewLease(box.io, box.engine);
    expect(box.puts[0].key).toBe(LEASE_KEY);
    expect(box.engine.phase).toEqual({ kind: 'ready' });
  });

  it('sends the cached world only when it is dirty and small enough', () => {
    keepalive(box.io, box.engine);
    box.engine.cursor = cursor();
    box.settings = { ...readySettings, ready: false };
    keepalive(box.io, box.engine);
    expect(box.kept).toHaveLength(0);

    box.settings = { ...readySettings };
    box.engine.cursor = cursor();
    keepalive(box.io, box.engine);
    expect(box.kept).toEqual([{ key: LEASE_KEY, match: { kind: 'if-none-match' } }]);

    box.engine.cursor = cursor({
      basisEtag: '"world"',
      leaseEtag: '"lease"',
      uploadedHash: 'same',
    });
    box.engine.cached = { body: new Uint8Array([1, 2]), hash: 'same' };
    keepalive(box.io, box.engine);
    expect(box.kept.at(-1)).toEqual({
      key: LEASE_KEY,
      match: { kind: 'if-match', etag: '"lease"' },
    });

    box.engine.cursor = cursor({ uploadedHash: 'old' });
    box.engine.cached = { body: new Uint8Array(60_001), hash: 'big' };
    keepalive(box.io, box.engine);
    expect(box.kept.at(-1)?.key).toBe(LEASE_KEY);

    box.engine.cursor = cursor({ basisEtag: '"world"', uploadedHash: 'old' });
    box.engine.cached = { body: new Uint8Array([9]), hash: 'fresh' };
    keepalive(box.io, box.engine);
    expect(box.kept.at(-2)).toEqual({
      key: WORLD_KEY,
      match: { kind: 'if-match', etag: '"world"' },
    });
    expect(box.kept.at(-1)?.match).toEqual({ kind: 'if-none-match' });

    box.engine.cursor = cursor({ uploadedHash: null });
    box.engine.cached = { body: new Uint8Array([9]), hash: 'fresh' };
    keepalive(box.io, box.engine);
    expect(box.kept.at(-2)).toEqual({ key: WORLD_KEY, match: { kind: 'if-none-match' } });
  });
});
