import { beforeEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({
  bind: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn(),
  stageArgs: [] as unknown[][],
  stages: [] as unknown[],
  sessions: [] as unknown[],
  panels: [] as unknown[][],
}));

const world = vi.hoisted(() => ({
  restoreWorld: vi.fn(async () => ({
    restored: false,
    unreadable: false,
    cause: null,
    pendingText: null,
  })),
  installWorldStore: vi.fn(),
  flushWorld: vi.fn(),
}));

const opening = vi.hoisted(() => ({
  openJournal: vi.fn(async () => ({ journal: {}, store: {} })),
}));

vi.mock('../../src/client/journal/api.js', () => ({ openJournal: opening.openJournal }));

vi.mock('../../src/client/stage.js', () => ({
  Stage: class {
    bind = control.bind;
    start = control.start;
    dispose = control.dispose;

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
}));

vi.mock('../../src/shared/sim/session.js', () => ({
  SimSession: class {
    spider = { tag: 'spider' };
    world = { tag: 'world' };
    frame = vi.fn();
    stop = vi.fn();

    constructor() {
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
  control.stageArgs = [];
  control.stages = [];
  control.sessions = [];
  control.panels = [];
  world.restoreWorld.mockClear();
  world.installWorldStore.mockClear();
  world.flushWorld.mockClear();
  world.restoreWorld.mockResolvedValue({
    restored: false,
    unreadable: false,
    cause: null,
    pendingText: null,
  });
  opening.openJournal.mockReset();
  opening.openJournal.mockResolvedValue({ journal: {}, store: {} });
});

describe('main', () => {
  it('refuses to start without the stage host', async () => {
    await expect(import('../../src/client/main.js')).rejects.toThrow('Missing #stage host element');
  });

  it('wires the session, stage, and panel together', async () => {
    const host = document.createElement('div');
    host.id = 'stage';
    document.body.append(host);

    await import('../../src/client/main.js');

    const session = control.sessions[0] as { spider: unknown; world: unknown; frame: unknown };
    const stage = control.stages[0];
    expect(control.stageArgs[0]).toEqual([host, session.spider]);
    expect(control.bind).toHaveBeenCalledTimes(1);
    expect(control.start).toHaveBeenCalledTimes(1);
    expect(control.panels[0][0]).toBe(document);
    expect(control.panels[0][1]).toBe(session);
    expect(control.panels[0][2]).toBe(stage);
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

    window.dispatchEvent(new Event('pagehide'));
    const stop = (session as unknown as { stop: ReturnType<typeof vi.fn> }).stop;
    expect(world.flushWorld).toHaveBeenCalledWith('hide');
    expect(world.flushWorld.mock.invocationCallOrder[0]).toBeLessThan(
      stop.mock.invocationCallOrder[0],
    );
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      control.dispose.mock.invocationCallOrder[0],
    );
    expect(stop).toHaveBeenCalled();
    expect(control.dispose).toHaveBeenCalled();
  });

  it('starts the stage when the journal cannot open', async () => {
    const host = document.createElement('div');
    host.id = 'stage';
    document.body.append(host);
    opening.openJournal.mockRejectedValueOnce(new Error('no worker'));

    await import('../../src/client/main.js');

    expect(control.stages).toHaveLength(1);
    expect(control.start).toHaveBeenCalledTimes(1);
    expect(world.installWorldStore).toHaveBeenCalled();
  });
});
