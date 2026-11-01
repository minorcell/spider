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

    const [step, world] = control.bind.mock.calls[0] as [(dt: number) => void, () => unknown];
    step(0.016);
    expect((session.frame as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(0.016);
    expect(world()).toBe(session.world);

    window.dispatchEvent(new Event('pagehide'));
    expect((session as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
    expect(control.dispose).toHaveBeenCalled();
  });
});
