import { beforeEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({
  bind: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn(),
  placeIsland: vi.fn(),
  setIslandSource: vi.fn(),
  hold: vi.fn(),
  retile: vi.fn(),
  stageArgs: [] as unknown[][],
  sessionArgs: [] as unknown[][],
  stages: [] as unknown[],
  sessions: [] as unknown[],
  panels: [] as unknown[][],
}));

const world = vi.hoisted(() => ({
  restoreWorld: vi.fn(async () => ({
    restored: false,
    cause: null,
    pendingText: null,
  })),
  installWorldStore: vi.fn(),
  flushWorld: vi.fn(),
  setWorldTerrainSource: vi.fn(),
}));

const opening = vi.hoisted(() => ({
  openJournal: vi.fn(async () => ({ journal: {}, store: {} })),
}));

const settings = vi.hoisted(() => ({ restoreSettings: vi.fn(async () => {}) }));

const stars = vi.hoisted(() => ({ syncStars: vi.fn() }));

const cloud = vi.hoisted(() => ({
  startCloud: vi.fn(async () => {}),
  cloudHolds: vi.fn(() => false),
  keepaliveCloud: vi.fn(),
}));

vi.mock('../../src/client/journal/api.js', () => ({ openJournal: opening.openJournal }));
vi.mock('../../src/client/settings.js', () => settings);

vi.mock('../../src/client/stars.js', () => ({
  REPO: 'minorcell/spider',
  REPO_STARS: '6',
  syncStars: stars.syncStars,
}));

vi.mock('../../src/client/cloud/sync.js', () => cloud);

vi.mock('../../src/client/stage.js', () => ({
  Stage: class {
    bind = control.bind;
    start = control.start;
    dispose = control.dispose;
    placeIsland = control.placeIsland;
    setIslandSource = control.setIslandSource;
    hold = control.hold;
    retile = control.retile;

    constructor(...args: unknown[]) {
      control.stageArgs.push(args);
      control.stages.push(this);
    }
  },
}));

vi.mock('../../src/client/panel.js', () => ({
  mountPanel: (...args: unknown[]) => {
    control.panels.push(args);
  },
}));

vi.mock('../../src/client/worldStore.js', () => ({
  restoreWorld: world.restoreWorld,
  installWorldStore: world.installWorldStore,
  flushWorld: world.flushWorld,
  setWorldTerrainSource: world.setWorldTerrainSource,
}));

vi.mock('../../src/shared/sim/session.js', () => ({
  SimSession: class {
    spider = { tag: 'spider' };
    world = { tag: 'world' };
    frame = vi.fn();
    cancel = vi.fn();

    constructor(...args: unknown[]) {
      control.sessionArgs.push(args);
      control.sessions.push(this);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  control.bind.mockReset();
  control.start.mockReset();
  control.dispose.mockReset();
  control.placeIsland.mockReset();
  control.setIslandSource.mockReset();
  control.hold.mockReset();
  control.retile.mockReset();
  control.stageArgs = [];
  control.sessionArgs = [];
  control.stages = [];
  control.sessions = [];
  control.panels = [];
  localStorage.clear();
  world.restoreWorld.mockClear();
  world.installWorldStore.mockClear();
  world.flushWorld.mockClear();
  world.setWorldTerrainSource.mockClear();
  world.restoreWorld.mockResolvedValue({
    restored: false,
    cause: null,
    pendingText: null,
  });
  opening.openJournal.mockReset();
  opening.openJournal.mockResolvedValue({ journal: {}, store: {} });
  stars.syncStars.mockReset();
  settings.restoreSettings.mockClear();
  cloud.startCloud.mockReset();
  cloud.cloudHolds.mockReset();
  cloud.keepaliveCloud.mockReset();
  cloud.startCloud.mockResolvedValue(undefined);
  cloud.cloudHolds.mockReturnValue(false);
});

describe('main', () => {
  it('refuses to start without the stage host', async () => {
    await expect(import('../../src/client/main.js')).rejects.toThrow('Missing #stage host element');
  });

  it('wires the session, stage, and panel together', async () => {
    const host = document.createElement('div');
    host.id = 'stage';
    document.body.append(host);
    world.restoreWorld.mockImplementationOnce(async () => {
      window.dispatchEvent(new Event('pagehide'));
      return { restored: false, cause: null, pendingText: null };
    });

    await import('../../src/client/main.js');
    await Promise.resolve();

    const session = control.sessions[0] as { spider: unknown; world: unknown; frame: unknown };
    const stage = control.stages[0];
    expect(control.stageArgs[0]).toEqual([host, session.spider]);
    expect(control.bind).toHaveBeenCalledTimes(1);
    expect(control.start).toHaveBeenCalledTimes(1);
    expect(control.placeIsland).toHaveBeenCalledTimes(1);
    expect(control.setIslandSource).toHaveBeenCalledTimes(1);
    expect(world.setWorldTerrainSource).toHaveBeenCalledTimes(1);
    expect(world.installWorldStore).toHaveBeenCalledTimes(1);
    expect(cloud.startCloud).toHaveBeenCalledTimes(1);
    expect(world.installWorldStore.mock.invocationCallOrder[0]).toBeLessThan(
      cloud.startCloud.mock.invocationCallOrder[0],
    );
    expect(control.panels[0][0]).toBe(document);
    expect(control.panels[0][1]).toBe(session);
    expect(control.panels[0][2]).toBe(stage);
    expect(stars.syncStars).toHaveBeenCalledWith(document);
    expect(world.restoreWorld.mock.invocationCallOrder[0]).toBeLessThan(
      control.start.mock.invocationCallOrder[0],
    );
    expect(control.start.mock.invocationCallOrder[0]).toBeLessThan(
      world.installWorldStore.mock.invocationCallOrder[0],
    );

    const [step, readWorld] = control.bind.mock.calls[0] as [(dt: number) => void, () => unknown];
    step(0.016);
    expect((session.frame as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(0.016);
    expect(readWorld()).toBe(session.world);

    const hooks = cloud.startCloud.mock.calls[0][0] as {
      hold(on: boolean): void;
      retile(): void;
    };
    hooks.hold(true);
    hooks.retile();
    expect(control.hold).toHaveBeenCalledWith(true);
    expect(control.retile).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    const cancel = (session as unknown as { cancel: ReturnType<typeof vi.fn> }).cancel;
    expect(world.flushWorld).toHaveBeenCalledWith('hide');
    expect(cloud.keepaliveCloud).toHaveBeenCalled();
    expect(world.flushWorld.mock.invocationCallOrder[0]).toBeLessThan(
      cloud.keepaliveCloud.mock.invocationCallOrder[0],
    );
    expect(cloud.keepaliveCloud.mock.invocationCallOrder[0]).toBeLessThan(
      cancel.mock.invocationCallOrder[0],
    );
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      control.dispose.mock.invocationCallOrder[0],
    );
    expect(cancel).toHaveBeenCalled();
    expect(control.dispose).toHaveBeenCalled();
  });

  it('starts the stage when the journal cannot open', async () => {
    const host = document.createElement('div');
    host.id = 'stage';
    document.body.append(host);
    opening.openJournal.mockRejectedValueOnce(new Error('no worker'));

    await import('../../src/client/main.js');
    await Promise.resolve();

    expect(control.stages).toHaveLength(1);
    expect(control.start).toHaveBeenCalledTimes(1);
    expect(world.installWorldStore).toHaveBeenCalledTimes(1);
    const store = world.restoreWorld.mock.calls[0][2] as unknown as {
      readSnapshot(): Promise<unknown>;
    };
    await expect(store.readSnapshot()).resolves.toBeNull();
  });

  it('keeps one persistence adapter for restoration and every checkpoint', async () => {
    const host = document.createElement('div');
    host.id = 'stage';
    document.body.append(host);
    const store = {
      readSnapshot: vi.fn(async () => 'saved'),
      putSnapshot: vi.fn(async () => {}),
      removeSnapshot: vi.fn(async () => {}),
      sweepSnapshots: vi.fn(async () => {}),
    };
    opening.openJournal.mockResolvedValueOnce({ journal: {}, store });

    await import('../../src/client/main.js');

    const adapter = world.restoreWorld.mock.calls[0][2] as unknown as typeof store;
    expect(world.installWorldStore.mock.calls[0][1]).toBe(adapter);
    await expect(adapter.readSnapshot()).resolves.toBe('saved');
    await adapter.putSnapshot();
    await adapter.removeSnapshot();
    await adapter.sweepSnapshots();
    expect(store.putSnapshot).toHaveBeenCalledOnce();
    expect(store.removeSnapshot).toHaveBeenCalledOnce();
    expect(store.sweepSnapshots).toHaveBeenCalledOnce();
    expect(settings.restoreSettings).toHaveBeenCalledOnce();
    expect(world.flushWorld).toHaveBeenCalledWith('poke');
  });

  it('does not upload a fresh island while the cloud copy is on screen', async () => {
    const host = document.createElement('div');
    host.id = 'stage';
    document.body.append(host);
    cloud.cloudHolds.mockReturnValue(true);

    await import('../../src/client/main.js');

    expect(cloud.startCloud).toHaveBeenCalledTimes(1);
    expect(world.flushWorld).not.toHaveBeenCalledWith('poke');
  });

  it('bakes the seed stored on this machine', async () => {
    const host = document.createElement('div');
    host.id = 'stage';
    document.body.append(host);
    const { SimSession: RealSession } = await vi.importActual<
      typeof import('../../src/shared/sim/session.js')
    >('../../src/shared/sim/session.js');
    const { captureBody } = await vi.importActual<
      typeof import('../../src/shared/sim/snapshot.js')
    >('../../src/shared/sim/snapshot.js');
    const { localDate } = await vi.importActual<typeof import('../../src/shared/dates.js')>(
      '../../src/shared/dates.js',
    );
    localStorage.setItem(
      'spider.world',
      JSON.stringify({
        ...captureBody(new RealSession(42), null),
        id: 'current',
        format: 3,
        savedAt: Date.now(),
        day: localDate(new Date()),
        owner: 'tab',
        seq: 1,
        leaseUntil: Date.now() + 60_000,
      }),
    );

    await import('../../src/client/main.js');

    expect(control.sessionArgs[0]?.[0]).toBe(42);
    const terrain = control.sessionArgs[0]?.[1] as { height(x: number, z: number): number };
    const readTerrain = world.setWorldTerrainSource.mock.calls[0][0] as (
      seed: number,
    ) => Promise<typeof terrain>;
    await expect(readTerrain(42)).resolves.toBe(terrain);
    const next = await readTerrain(43);
    expect(next).not.toBe(terrain);
    expect(next.height(0, 0)).toBe(0);

    const readIsland = control.setIslandSource.mock.calls[0][0] as (
      seed: number,
    ) => Promise<{ children: unknown[] }>;
    await expect(readIsland(42)).resolves.toMatchObject({ children: { length: 3 } });
  });
});
