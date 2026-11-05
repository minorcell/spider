import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundleBytes, type CloudBundle } from '../../../src/client/cloud/bundle.js';
import { resetCloudSettings, writeCloud } from '../../../src/client/cloud/settings.js';
import {
  chooseCloudLocal,
  chooseCloudRemote,
  cloudChoice,
  cloudHolds,
  cloudPhase,
  keepaliveCloud,
  noteCloud,
  onCloudPhase,
  resetCloud,
  startCloud,
  takeOverCloud,
} from '../../../src/client/cloud/sync.js';
import * as dbModule from '../../../src/client/journal/db.js';
import { Diary } from '../../../src/client/journal/diary.js';
import { openSpiderDb, resetSpiderDb, type MemoryPage } from '../../../src/client/journal/db.js';
import {
  flushWorld,
  installWorldStore,
  resetWorldStore,
  restoreWorld,
} from '../../../src/client/worldStore.js';
import { captureBody } from '../../../src/shared/sim/snapshot.js';
import { SimSession } from '../../../src/shared/sim/session.js';

const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
const originalSetInterval = globalThis.setInterval.bind(globalThis);

const page = (date: string): MemoryPage => ({
  date,
  description: date,
  noted: '',
  summary: '',
  updatedAt: 1,
});

function worldBundle(seed: number, memories: MemoryPage[] = []): CloudBundle {
  return {
    format: 1,
    deviceId: 'remote',
    world: captureBody(new SimSession(seed), null),
    memories,
  };
}

function answered(status: number, body: BodyInit | null, etag?: string): Response {
  return new Response(body, { status, headers: etag ? { etag } : {} });
}

function decodeBody(body: BodyInit | null | undefined): string | null {
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  return null;
}

interface CloudFake {
  calls: Array<{ url: string; init: RequestInit }>;
  lease: { deviceId: string; until: number } | null;
  worldStatus: number;
}

function installCloud(bundle: CloudBundle | null, status = 200): CloudFake {
  const state: CloudFake = { calls: [], lease: null, worldStatus: status };
  const body = bundle ? bundleBytes(bundle) : null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      state.calls.push({ url: String(url), init });
      const method = init.method ?? 'GET';
      const key = String(url);
      if (key.includes('lease.json')) {
        if (method === 'GET') {
          if (!state.lease) return answered(404, '');
          return answered(200, JSON.stringify(state.lease), '"lease"');
        }
        const written = decodeBody(init.body);
        if (written) state.lease = JSON.parse(written) as CloudFake['lease'];
        return answered(200, '', '"lease-put"');
      }
      if (key.includes('conflicts')) return answered(200, '', '"park"');
      if (method === 'GET') {
        if (state.worldStatus !== 200 || !body) return answered(state.worldStatus, '');
        return answered(200, body, '"v"');
      }
      return answered(200, '', '"world"');
    }),
  );
  return state;
}

function enable(): void {
  writeCloud(
    {
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'spider',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    },
    true,
  );
}

async function boot(seed = 2): Promise<SimSession> {
  const session = new SimSession(seed);
  await restoreWorld(session);
  installWorldStore(session);
  return session;
}

async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => originalSetTimeout(resolve, 0));
}

/** Wait until a cloud pass has stopped issuing requests. */
async function quiet(cloud: CloudFake): Promise<void> {
  let stable = 0;
  let last = -1;
  for (let i = 0; i < 40 && stable < 5; i++) {
    await new Promise((resolve) => originalSetTimeout(resolve, 0));
    if (cloud.calls.length === last) stable += 1;
    else {
      stable = 0;
      last = cloud.calls.length;
    }
  }
}

let idleTick: (() => void) | undefined;
let leaseTick: (() => void) | undefined;

beforeEach(async () => {
  localStorage.clear();
  resetCloud();
  resetCloudSettings();
  resetWorldStore();
  await resetSpiderDb();
  idleTick = undefined;
  leaseTick = undefined;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimerHandler, ms?: number) => {
    if (ms === 60_000) {
      idleTick = () => {
        (fn as () => void)();
      };
      return 61 as unknown as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(fn, ms);
  }) as typeof setTimeout);
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler, ms?: number) => {
    if (ms === 30_000) {
      leaseTick = () => {
        (fn as () => void)();
      };
      return 31 as unknown as ReturnType<typeof setInterval>;
    }
    return originalSetInterval(fn, ms);
  }) as typeof setInterval);
});

afterEach(() => {
  resetCloud();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cloud sync', () => {
  it('adopts the cloud world and replaces the diary', async () => {
    const session = await boot(2);
    const db = await openSpiderDb();
    await db.put('memories', page('2026-11-01'));
    await db.put('memories', page('2026-11-02'));
    enable();
    installCloud(worldBundle(8, [page('2026-11-06')]));
    const hold = vi.fn();
    const retile = vi.fn();
    const phases: string[] = [];
    onCloudPhase((phase) => phases.push(phase.kind));
    await startCloud({ hold, retile });
    expect(session.world.seed).toBe(8);
    expect(retile).toHaveBeenCalledOnce();
    expect(hold).toHaveBeenCalledWith(false);
    expect(cloudPhase()).toEqual({ kind: 'ready' });
    expect(cloudHolds()).toBe(false);
    expect(await db.getAll('memories')).toEqual([page('2026-11-06')]);
    expect(phases).toContain('ready');
    const again = vi.fn();
    await startCloud({ hold, retile: again });
    expect(again).not.toHaveBeenCalled();
  });

  it('adopts before the picture is connected, then does not retile a matching copy', async () => {
    const session = await boot(2);
    enable();
    installCloud(worldBundle(8, []));
    await noteCloud('poke');
    expect(session.world.seed).toBe(8);
    const retile = vi.fn();
    await startCloud({ hold: vi.fn(), retile });
    expect(retile).not.toHaveBeenCalled();
    expect(cloudPhase()).toEqual({ kind: 'ready' });
  });

  it('uploads again after the world or the diary changes', async () => {
    const session = await boot(2);
    enable();
    const cloud = installCloud(null, 404);
    await startCloud({ hold: vi.fn(), retile: vi.fn() });
    const started = cloud.calls.length;
    session.spider.root.position.x += 1;
    flushWorld('poke');
    await quiet(cloud);
    expect(cloud.calls.length).toBeGreaterThan(started);

    const moved = cloud.calls.length;
    const diary = await Diary.open(new Date('2026-11-06T00:00:00.000Z'));
    await diary.write({ date: '2026-11-06', line: '水边' });
    await quiet(cloud);
    expect(cloud.calls.length).toBeGreaterThan(moved);
  });

  it('asks when both sides already have progress', async () => {
    const session = await boot(3);
    const db = await openSpiderDb();
    await db.put('snapshots', {
      ...captureBody(session, null),
      id: 'current',
      format: 3,
      savedAt: Date.now(),
      day: '2026-11-06',
      owner: 'tab',
      seq: 1,
      leaseUntil: Date.now() + 60_000,
    });
    enable();
    installCloud(worldBundle(9, [page('2026-11-06')]));
    const hold = vi.fn();
    await startCloud({ hold, retile: vi.fn() });
    expect(cloudPhase().kind).toBe('choose');
    expect(cloudHolds()).toBe(true);
    expect(cloudChoice()?.remote.world.seed).toBe(9);
    expect(hold).toHaveBeenCalledWith(true);
    expect(session.world.seed).toBe(3);
    await chooseCloudRemote();
    expect(session.world.seed).toBe(9);
    await chooseCloudLocal();
    await takeOverCloud();
  });

  it('waits out the idle timer and skips work before the endpoint is enabled', async () => {
    await boot();
    const cloud = installCloud(null, 404);
    noteCloud('poke');
    noteCloud('interval');
    await drain();
    expect(cloud.calls).toHaveLength(0);
    enable();
    await startCloud({ hold: vi.fn(), retile: () => undefined });
    const before = cloud.calls.length;
    noteCloud('interval');
    noteCloud('interval');
    expect(cloud.calls.length).toBe(before);
    idleTick?.();
    await drain();
    expect(cloud.calls.length).toBeGreaterThan(before);
  });

  it('renews the lease only while visible, then stops when reset', async () => {
    await boot();
    enable();
    const cloud = installCloud(null, 404);
    await startCloud({ hold: vi.fn(), retile: vi.fn() });
    const started = cloud.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    leaseTick?.();
    await drain();
    expect(cloud.calls.length).toBe(started);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    leaseTick?.();
    await drain();
    expect(cloud.calls.length).toBeGreaterThan(started);
    const renewed = cloud.calls.length;
    window.dispatchEvent(new Event('online'));
    await drain();
    expect(cloud.calls.length).toBeGreaterThan(renewed);

    resetCloud();
    const parked = cloud.calls.length;
    window.dispatchEvent(new Event('online'));
    leaseTick?.();
    await drain();
    expect(cloud.calls.length).toBe(parked);
  });

  it('locks while another computer holds the lease', async () => {
    await boot(4);
    enable();
    const cloud = installCloud(worldBundle(4));
    const hold = vi.fn();
    await startCloud({ hold, retile: vi.fn() });
    expect(cloudPhase().kind).toBe('ready');
    cloud.lease = { deviceId: 'other', until: Date.now() + 60_000 };
    noteCloud('hide');
    await drain();
    expect(cloudPhase().kind).toBe('locked');
    expect(cloudHolds()).toBe(true);
    expect(hold).toHaveBeenCalledWith(true);
    await takeOverCloud();
    expect(cloudPhase().kind).toBe('ready');
    expect(cloudHolds()).toBe(false);
  });

  it('reports a broken database and survives a paint error', async () => {
    await boot();
    enable();
    installCloud(null, 404);
    vi.spyOn(dbModule, 'openSpiderDb').mockRejectedValue(new Error('closed'));
    await startCloud({ hold: vi.fn(), retile: vi.fn() });
    expect(cloudPhase()).toEqual({ kind: 'error', message: '云端存档读不出来' });
    vi.mocked(dbModule.openSpiderDb).mockRestore();

    resetCloud();
    await expect(
      startCloud({
        hold() {
          throw new Error('paint');
        },
        retile() {},
      }),
    ).rejects.toThrow('paint');
    await expect(startCloud({ hold: vi.fn(), retile: vi.fn() })).resolves.toBeUndefined();
  });

  it('sends a closing upload when the cached world never landed', async () => {
    const session = await boot(5);
    const db = await openSpiderDb();
    await db.put('snapshots', {
      ...captureBody(session, null),
      id: 'current',
      format: 3,
      savedAt: Date.now(),
      day: '2026-11-06',
      owner: 'tab',
      seq: 1,
      leaseUntil: Date.now() + 60_000,
    });
    enable();
    const cloud = installCloud(worldBundle(5), 500);
    await startCloud({ hold: vi.fn(), retile: vi.fn() });
    expect(cloudPhase()).toEqual({ kind: 'error', message: '云端存档读不出来' });
    const before = cloud.calls.length;
    keepaliveCloud();
    await drain();
    expect(cloud.calls.slice(before).some((call) => call.init.keepalive === true)).toBe(true);
  });

  it('does not adopt a world the page cannot apply', async () => {
    enable();
    installCloud(worldBundle(8, []));
    const retile = vi.fn();
    await startCloud({ hold: vi.fn(), retile });
    expect(retile).not.toHaveBeenCalled();
    expect(cloudPhase()).toEqual({ kind: 'error', message: '云端存档读不出来' });
  });
});
