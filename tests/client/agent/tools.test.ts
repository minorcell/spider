import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spiderTools } from '../../../src/client/agent/tools.js';
import type { GoalOutcome, SimSession } from '../../../src/shared/sim/session.js';
import type { Observation } from '../../../src/shared/state.js';
import { VIEW_DISTANCE } from '../../../src/shared/world.js';
import { MARK_LIMIT } from '../../../src/shared/config.js';

const observation: Observation = {
  time: 0,
  view: VIEW_DISTANCE,
  beyond: 0,
  hidden: 0,
  self: {
    x: 0,
    y: 0,
    z: 0,
    ground: 0,
    heading: 0,
    height: 0,
    speed: 0,
    cover: null,
    home: true,
    wet: false,
    waterDepth: 0,
    swimming: false,
    water: null,
    shore: null,
    carrying: [],
    ahead: { open: 8, by: 'clear', id: null, kind: null },
    nearby: [],
    ways: [{ x: 0, z: -8, open: 8 }],
  },
  entities: [],
};

let session: Record<string, ReturnType<typeof vi.fn>> & { lamp?: boolean };

const world = {
  clock: {
    localDate: '2026-11-05',
    localTime: '12:00:00',
    phase: 'day' as const,
    daylight: 1,
  },
};

function outcome(over: Partial<GoalOutcome> = {}): GoalOutcome {
  return { ok: true, ...over };
}

function execute(tool: { execute?: unknown }, input: unknown): Promise<unknown> {
  return (tool.execute as (value: unknown, options: unknown) => Promise<unknown>)(input, {
    toolCallId: '1',
    messages: [],
  });
}

beforeEach(() => {
  session = {
    observe: vi.fn(() => observation),
    worldInfo: vi.fn(() => world),
    sense: vi.fn((withWays = false) => {
      if (withWays) return observation.self;
      const { ways: _ways, nearby: _nearby, ...self } = observation.self;
      return self;
    }),
    turn: vi.fn(async () => outcome()),
    turnTo: vi.fn(async () => outcome()),
    moveTo: vi.fn(async () => outcome()),
    mark: vi.fn(() => outcome({ action: 'mark', name: '水边', x: 1, z: 2 })),
    marks: vi.fn(() => [
      { name: '水边', x: 1, z: 2, distance: 2.2, bearing: 30 },
      { name: '坡顶', x: -3, z: 4, note: '能看见巢', distance: 5, bearing: -20 },
    ]),
    forgetMark: vi.fn(() => outcome({ action: 'forget', name: '水边' })),
    approach: vi.fn(async () => outcome()),
    eat: vi.fn(async () => outcome()),
    pickUp: vi.fn(async () => outcome()),
    drink: vi.fn(() => outcome({ action: 'drink' })),
    drop: vi.fn(() => outcome()),
    store: vi.fn(() => outcome()),
    sleep: vi.fn(async () => outcome()),
    setHeight: vi.fn(async () => outcome()),
    near: vi.fn(() => [
      {
        id: 'apple-1',
        kind: 'apple',
        stage: 0,
        properties: ['edible', 'carryable'],
        distance: 0.8,
        bearing: 0,
      },
    ]),
  };
});

describe('spiderTools', () => {
  it('offers every action', () => {
    expect(Object.keys(spiderTools(session as unknown as SimSession)).sort()).toEqual([
      'act',
      'go',
      'lamp',
      'mark',
      'observe',
      'set_height',
    ]);
  });

  it('accepts one go mode and one act verb', () => {
    const tools = spiderTools(session as unknown as SimSession);
    const go = tools.go.inputSchema;
    const act = tools.act.inputSchema;
    expect(go.safeParse({ description: '走过去', mode: 'point', x: 1, z: 2 }).success).toBe(true);
    expect(go.safeParse({ description: '过去', mode: 'id', id: 'apple-1' }).success).toBe(true);
    expect(go.safeParse({ description: '转身', mode: 'heading', heading: 0 }).success).toBe(true);
    expect(go.safeParse({ description: '转身', mode: 'degrees', degrees: 30 }).success).toBe(true);
    expect(go.safeParse({ description: '走', mode: 'point', id: 'apple-1' }).success).toBe(false);
    expect(go.safeParse({ description: '走', x: 1, z: 2 }).success).toBe(false);
    expect(act.safeParse({ description: '吃掉', verb: 'eat', id: 'apple-1' }).success).toBe(true);
    expect(act.safeParse({ description: '喝水', verb: 'drink' }).success).toBe(true);
    expect(act.safeParse({ description: '睡觉', verb: 'sleep' }).success).toBe(true);
    expect(act.safeParse({ description: '吃掉', verb: 'eat' }).success).toBe(false);
    expect(act.safeParse({ description: '喝水', verb: 'drink', id: 'apple-1' }).success).toBe(true);
  });

  it('observes and envelopes the result', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    const result = (await execute(tools.observe, { distance: 3 })) as Record<string, unknown>;
    expect(session.observe).toHaveBeenCalledWith(3);
    expect(result).toMatchObject({ ok: true, world, observation });
    expect(result).not.toHaveProperty('ahead');
  });

  it('observes the full view when no distance is given', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.observe, {});
    expect(session.observe).toHaveBeenCalledWith(VIEW_DISTANCE);
  });

  it('explains why an observation is partial and how to recover', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.observe.mockReturnValueOnce({
      ...observation,
      view: 4.5,
      self: { ...observation.self, cover: 'grass' },
    });
    const grass = (await execute(tools.observe, { distance: VIEW_DISTANCE })) as Record<
      string,
      any
    >;
    expect(grass.hint).toMatchObject({ code: 'view-limited-by-grass', next: 'set_height' });

    session.observe.mockReturnValueOnce({ ...observation, beyond: 2, hidden: 1 });
    const partial = (await execute(tools.observe, { distance: VIEW_DISTANCE })) as Record<
      string,
      any
    >;
    expect(partial.hint).toMatchObject({ code: 'partial-observation', next: 'go' });

    session.observe.mockReturnValueOnce({ ...observation, view: 1.6 });
    session.worldInfo.mockReturnValueOnce({
      ...world,
      clock: { ...world.clock, localTime: '00:00:00', phase: 'night', daylight: 0 },
      lamp: false,
      view: 0.1,
    });
    const dark = (await execute(tools.observe, { distance: VIEW_DISTANCE })) as Record<string, any>;
    expect(dark.hint).toMatchObject({ code: 'view-limited-by-light', next: 'lamp' });

    session.lamp = true;
    session.observe.mockReturnValueOnce({ ...observation, view: 10 });
    session.worldInfo.mockReturnValueOnce({
      ...world,
      clock: { ...world.clock, phase: 'night', daylight: 0 },
      lamp: true,
      view: 0.64,
    });
    const lit = (await execute(tools.observe, { distance: VIEW_DISTANCE })) as Record<string, any>;
    expect(lit.hint).toMatchObject({ code: 'view-limited-by-light', next: 'go' });
  });

  it('lets the spider turn the lamp on and off', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.setLamp = vi.fn();
    session.worldInfo.mockReturnValue({ ...world, lamp: true, view: 0.64 });
    const on = (await execute(tools.lamp, { on: true })) as Record<string, unknown>;
    expect(session.setLamp).toHaveBeenCalledWith(true);
    expect(on).toMatchObject({ ok: true, action: 'lamp-on' });
    const off = (await execute(tools.lamp, { on: false })) as Record<string, unknown>;
    expect(session.setLamp).toHaveBeenCalledWith(false);
    expect(off).toMatchObject({ ok: true, action: 'lamp-off' });
  });

  it('drinks through the session and returns the body', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    const result = (await execute(tools.act, { verb: 'drink' })) as Record<string, unknown>;
    expect(session.drink).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, action: 'drink' });
    expect(result).toHaveProperty('self');
    expect(result).toHaveProperty('near');
  });

  it('returns the body and what is in reach, and strips the halt field', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.moveTo.mockResolvedValue(outcome({ halt: 'solid', achieved: 1 }));
    const result = (await execute(tools.go, {
      mode: 'point',
      x: 2,
      z: 0,
    })) as Record<string, unknown>;
    expect(session.sense).toHaveBeenCalledWith(false);
    expect(session.near).toHaveBeenCalledOnce();
    expect(session.observe).not.toHaveBeenCalled();
    expect(session.moveTo).toHaveBeenCalledWith(2, 0, false);
    expect(result).not.toHaveProperty('halt');
    expect(result).not.toHaveProperty('observation');
    expect(result.achieved).toBe(1);
    expect(result.near).toEqual([
      {
        id: 'apple-1',
        kind: 'apple',
        stage: 0,
        properties: ['edible', 'carryable'],
        distance: 0.8,
        bearing: 0,
      },
    ]);
    expect(result.self).not.toHaveProperty('ways');
  });

  it('attaches ways when a move is blocked', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    for (const reason of ['blocked', 'steep', 'no-path'] as const) {
      session.sense.mockClear();
      session.moveTo.mockResolvedValue(outcome({ reason }));
      const result = (await execute(tools.go, {
        mode: 'point',
        x: 2,
        z: 0,
      })) as Record<string, unknown>;
      expect(session.sense).toHaveBeenCalledWith(true);
      expect(session.near).toHaveBeenCalled();
      expect(result.self).toHaveProperty('ways');
      expect(result).toHaveProperty('near');
    }
  });

  it.each([
    ['out-of-reach', 'go'],
    ['nothing-to-eat', 'observe'],
    ['nothing-to-carry', 'observe'],
    ['full', 'act'],
    ['no-water', 'observe'],
    ['cancelled', 'observe'],
    ['timeout', 'observe'],
  ] as const)('gives a recovery hint for %s', async (reason, next) => {
    const tools = spiderTools(session as unknown as SimSession);
    session.moveTo.mockResolvedValue(outcome({ reason }));
    const result = (await execute(tools.go, { mode: 'point', x: 1, z: 0 })) as Record<string, any>;
    expect(result.hint).toMatchObject({ next });
    expect(result).toHaveProperty('world.clock.localTime');
    expect(result).toHaveProperty('near');
  });

  it('still says to go when a block has no openings attached', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.sense.mockReturnValueOnce({ ...observation.self, ways: undefined });
    session.moveTo.mockResolvedValue(outcome({ reason: 'blocked' }));
    const result = (await execute(tools.go, { mode: 'point', x: 1, z: 0 })) as Record<string, any>;
    expect(result.hint).toMatchObject({ code: 'blocked', next: 'go' });
  });

  it('attaches the same near context after every spatial action', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    const beside = [
      ['go', { mode: 'point', x: 1, z: 2 }],
      ['go', { mode: 'id', id: 'apple-1' }],
      ['act', { verb: 'eat', id: 'apple-1' }],
      ['act', { verb: 'pick_up', id: 'apple-1' }],
      ['act', { verb: 'drop', id: 'apple-1' }],
      ['act', { verb: 'store', id: 'apple-1' }],
    ] as const;
    for (const [name, input] of beside) {
      session.near.mockClear();
      const result = (await execute(tools[name], input)) as Record<string, unknown>;
      expect(session.near).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('near');
      expect(result).not.toHaveProperty('observation');
    }
    const plain = [
      ['go', { mode: 'degrees', degrees: 10 }],
      ['go', { mode: 'heading', heading: 0 }],
      ['act', { verb: 'drink' }],
      ['set_height', { level: 0 }],
      ['act', { verb: 'sleep' }],
      ['observe', {}],
    ] as const;
    for (const [name, input] of plain) {
      session.near.mockClear();
      const result = (await execute(tools[name], input)) as Record<string, unknown>;
      expect(session.near).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('near');
    }
  });

  it('marks, lists, and forgets named places', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await expect(
      execute(tools.mark, { command: 'add', name: '水边', note: '喝水' }),
    ).resolves.toMatchObject({ ok: true, action: 'mark', name: '水边' });
    expect(session.mark).toHaveBeenCalledWith('水边', '喝水');

    await expect(execute(tools.mark, { command: 'list' })).resolves.toMatchObject({
      ok: true,
      marks: [
        { name: '水边', x: 1, z: 2, distance: 2.2, bearing: 30 },
        { name: '坡顶', x: -3, z: 4, note: '能看见巢', distance: 5, bearing: -20 },
      ],
    });
    expect(session.marks).toHaveBeenCalledOnce();

    await expect(execute(tools.mark, { command: 'remove', name: '水边' })).resolves.toMatchObject({
      ok: true,
      action: 'forget',
      name: '水边',
    });
    expect(session.forgetMark).toHaveBeenCalledWith('水边');
  });

  it('needs a name for add and remove', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    for (const command of ['add', 'remove'] as const) {
      await expect(execute(tools.mark, { command })).resolves.toMatchObject({
        ok: false,
        reason: 'need-name',
      });
    }
    expect(session.mark).not.toHaveBeenCalled();
    expect(session.forgetMark).not.toHaveBeenCalled();
  });

  it('sends a dry body toward water it can already feel', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.sense.mockReturnValueOnce({
      ...observation.self,
      water: { x: 3, z: -1, distance: 3, bearing: 20, depth: 0.4, span: 2 },
    });
    session.moveTo.mockResolvedValueOnce(outcome({ reason: 'no-water' }));
    const result = (await execute(tools.go, { mode: 'point', x: 1, z: 0 })) as Record<string, any>;
    expect(result.hint).toMatchObject({ code: 'no-water', next: 'go' });
  });

  it('asks for a higher body when a slope has no opening', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.sense.mockReturnValueOnce({ ...observation.self, ways: [] });
    session.moveTo.mockResolvedValueOnce(outcome({ reason: 'steep' }));
    const result = (await execute(tools.go, { mode: 'point', x: 1, z: 0 })) as Record<string, any>;
    expect(result.hint).toMatchObject({ code: 'steep', next: 'set_height' });
  });

  it('asks for a fresh id when the target is gone', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.approach.mockResolvedValueOnce(
      outcome({ ok: false, reason: 'not-found', id: 'apple-1' }),
    );
    await expect(execute(tools.go, { mode: 'id', id: 'apple-1' })).resolves.toMatchObject({
      ok: false,
      reason: 'not-found',
      id: 'apple-1',
      world,
      hint: { code: 'stale-target', next: 'observe' },
    });
    expect(session.near).toHaveBeenCalledOnce();
  });

  it('passes movement arguments through', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.go, { mode: 'degrees', degrees: 45 });
    const byHeading = (await execute(tools.go, { mode: 'heading', heading: -90 })) as Record<
      string,
      unknown
    >;
    await execute(tools.go, { mode: 'point', x: 1, z: 2, fast: true });
    await execute(tools.go, { mode: 'id', id: 'apple-1', standoff: 0.5, fast: true });
    expect(session.turn).toHaveBeenCalledWith(45);
    expect(session.turnTo).toHaveBeenCalledWith(-90);
    expect(byHeading.heading).toBe(-90);
    expect(session.moveTo).toHaveBeenCalledWith(1, 2, true);
    expect(session.approach).toHaveBeenCalledWith('apple-1', 0.5, true);
  });

  it('uses defaults for optional movement arguments', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.go, { mode: 'point', x: 1, z: 2 });
    await execute(tools.go, { mode: 'id', id: 'apple-1' });
    expect(session.moveTo).toHaveBeenCalledWith(1, 2, false);
    expect(session.approach).toHaveBeenCalledWith('apple-1', undefined, false);
  });

  it('passes item actions through', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.act, { verb: 'eat', id: 'apple-1' });
    await execute(tools.act, { verb: 'pick_up', id: 'apple-1' });
    await execute(tools.act, { verb: 'drop', id: 'apple-1' });
    await execute(tools.act, { verb: 'store', id: 'apple-1' });
    await execute(tools.act, { verb: 'sleep' });
    await execute(tools.set_height, { level: 0.3 });
    expect(session.eat).toHaveBeenCalledWith('apple-1');
    expect(session.pickUp).toHaveBeenCalledWith('apple-1');
    expect(session.drop).toHaveBeenCalledWith('apple-1');
    expect(session.store).toHaveBeenCalledWith('apple-1');
    expect(session.sleep).toHaveBeenCalled();
    expect(session.setHeight).toHaveBeenCalledWith(0.3);
  });

  it('reads and writes the diary without touching the body', async () => {
    const memory = {
      list: vi.fn(async () => [{ date: '2026-11-02', line: '不要吃红的' }]),
      get: vi.fn(async () => null),
      write: vi.fn(async (input: { date: string }) => ({
        date: input.date,
        line: '不要吃红的',
        noted: '不要吃红的',
        summary: '',
      })),
    };
    const tools = spiderTools(session as unknown as SimSession, memory);
    expect(Object.keys(tools)).toContain('memory');
    await expect(execute(tools.memory, { command: 'list' })).resolves.toMatchObject({
      ok: true,
      pages: [{ date: '2026-11-02', line: '不要吃红的' }],
    });
    await expect(execute(tools.memory, { command: 'get' })).resolves.toMatchObject({
      ok: false,
      reason: 'need-date',
    });
    await expect(
      execute(tools.memory, { command: 'get', date: '2026-11-01' }),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'not-found',
    });
    memory.get.mockResolvedValueOnce({
      date: '2026-11-02',
      line: '不要吃红的',
      noted: '不要吃红的',
      summary: '',
    } as never);
    await expect(
      execute(tools.memory, { command: 'get', date: '2026-11-02' }),
    ).resolves.toMatchObject({
      ok: true,
      line: '不要吃红的',
    });
    await expect(
      execute(tools.memory, { command: 'write', date: '2026-11-02', noted: '不要吃红的' }),
    ).resolves.toMatchObject({ ok: true, noted: '不要吃红的' });
    expect(session.observe).not.toHaveBeenCalled();
    expect(session.sense).not.toHaveBeenCalled();
  });

  it('explains the observe limits in plain words', () => {
    const tools = spiderTools(session as unknown as SimSession);
    expect(tools.observe.description).toContain('草丛');
    expect(tools.observe.description).toContain('抬高身体');
  });

  it('advertises the place limit in the mark description', () => {
    const tools = spiderTools(session as unknown as SimSession);
    expect(tools.mark.description).toContain(String(MARK_LIMIT));
  });
});
