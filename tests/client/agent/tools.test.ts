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
    ways: ['正前方可以走 8 米。'],
  },
  entities: [],
};

let session: Record<string, ReturnType<typeof vi.fn>>;

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
    walk: vi.fn(async () => outcome()),
    turn: vi.fn(async () => outcome()),
    turnTo: vi.fn(async () => outcome()),
    moveTo: vi.fn(async () => outcome()),
    mark: vi.fn(() => outcome({ action: 'mark', name: '水边', x: 1, z: 2 })),
    marks: vi.fn(() => [
      { name: '水边', x: 1, z: 2, distance: 2.2, bearing: 30 },
      { name: '坡顶', x: -3, z: 4, note: '能看见巢', distance: 5, bearing: -20 },
    ]),
    forgetMark: vi.fn(() => outcome({ action: 'forget', name: '水边' })),
    goToMark: vi.fn(async () => outcome({ reason: 'reached', name: '水边' })),
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
      'approach',
      'drink',
      'drop',
      'eat',
      'mark',
      'move_to',
      'observe',
      'pick_up',
      'set_height',
      'sleep',
      'store',
      'turn',
      'walk',
    ]);
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
    expect(partial.hint).toMatchObject({ code: 'partial-observation', next: 'observe' });

    session.observe.mockReturnValueOnce({ ...observation, view: 8.8 });
    session.worldInfo.mockReturnValueOnce({
      ...world,
      clock: { ...world.clock, phase: 'night', daylight: 0 },
    });
    const dark = (await execute(tools.observe, { distance: VIEW_DISTANCE })) as Record<string, any>;
    expect(dark.hint).toMatchObject({ code: 'view-limited-by-light', next: 'observe' });
  });

  it('drinks through the session and returns the body', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    const result = (await execute(tools.drink, {})) as Record<string, unknown>;
    expect(session.drink).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, action: 'drink' });
    expect(result).toHaveProperty('self');
    expect(result).toHaveProperty('near');
  });

  it('returns the body and what is in reach, and strips the halt field', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.walk.mockResolvedValue(outcome({ halt: 'solid', achieved: 1 }));
    const result = (await execute(tools.walk, { distance: 2 })) as Record<string, unknown>;
    expect(session.sense).toHaveBeenCalledWith(false);
    expect(session.near).toHaveBeenCalledOnce();
    expect(session.observe).not.toHaveBeenCalled();
    expect(session.walk).toHaveBeenCalledWith(2, false);
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

  it('attaches ways when a walk is blocked', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    for (const reason of ['blocked', 'steep', 'no-path'] as const) {
      session.sense.mockClear();
      session.walk.mockResolvedValue(outcome({ reason }));
      const result = (await execute(tools.walk, { distance: 2 })) as Record<string, unknown>;
      expect(session.sense).toHaveBeenCalledWith(true);
      expect(session.near).toHaveBeenCalled();
      expect(result.self).toHaveProperty('ways');
      expect(result).toHaveProperty('near');
    }
  });

  it.each([
    ['out-of-reach', 'approach'],
    ['nothing-to-eat', 'observe'],
    ['nothing-to-carry', 'observe'],
    ['full', 'drop'],
    ['no-water', 'observe'],
    ['cancelled', 'observe'],
    ['timeout', 'observe'],
  ] as const)('gives a recovery hint for %s', async (reason, next) => {
    const tools = spiderTools(session as unknown as SimSession);
    session.walk.mockResolvedValue(outcome({ reason }));
    const result = (await execute(tools.walk, { distance: 1 })) as Record<string, any>;
    expect(result.hint).toMatchObject({ next });
    expect(result).toHaveProperty('world.clock.localTime');
    expect(result).toHaveProperty('near');
  });

  it('gives a less specific blocked hint when no route sentences are available', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.sense.mockReturnValueOnce({ ...observation.self, ways: undefined });
    session.walk.mockResolvedValue(outcome({ reason: 'blocked' }));
    const result = (await execute(tools.walk, { distance: 1 })) as Record<string, any>;
    expect(result.hint).toMatchObject({ code: 'blocked', next: 'move_to' });
  });

  it('attaches the same near context after every spatial action', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    const beside = [
      ['walk', { distance: 1 }],
      ['move_to', { x: 1, z: 2 }],
      ['approach', { id: 'apple-1' }],
      ['eat', { id: 'apple-1' }],
      ['pick_up', { id: 'apple-1' }],
      ['drop', {}],
      ['store', {}],
    ] as const;
    for (const [name, input] of beside) {
      session.near.mockClear();
      const result = (await execute(tools[name], input)) as Record<string, unknown>;
      expect(session.near).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('near');
      expect(result).not.toHaveProperty('observation');
    }
    const plain = [
      ['turn', { degrees: 10 }],
      ['turn', { heading: 0 }],
      ['drink', {}],
      ['set_height', { level: 0 }],
      ['sleep', {}],
      ['observe', {}],
    ] as const;
    for (const [name, input] of plain) {
      session.near.mockClear();
      const result = (await execute(tools[name], input)) as Record<string, unknown>;
      expect(session.near).toHaveBeenCalledOnce();
      expect(result).toHaveProperty('near');
    }
  });

  it('marks, lists, forgets, and returns to named places', async () => {
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

    const result = (await execute(tools.mark, {
      command: 'go',
      name: '水边',
      fast: true,
    })) as Record<string, unknown>;
    expect(session.goToMark).toHaveBeenCalledWith('水边', true);
    expect(result).toMatchObject({ ok: true, name: '水边' });
    expect(result).toHaveProperty('self');
    expect(result).toHaveProperty('near');
    expect(result).not.toHaveProperty('observation');
  });

  it('needs a name for add, remove, and go', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    for (const command of ['add', 'remove', 'go'] as const) {
      await expect(execute(tools.mark, { command })).resolves.toMatchObject({
        ok: false,
        reason: 'need-name',
      });
    }
    expect(session.mark).not.toHaveBeenCalled();
    expect(session.forgetMark).not.toHaveBeenCalled();
    expect(session.goToMark).not.toHaveBeenCalled();
  });

  it('does not attach the body when a place is missing', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.goToMark.mockResolvedValueOnce(
      outcome({ ok: false, reason: 'not-found', name: '水边' }),
    );
    await expect(execute(tools.mark, { command: 'go', name: '水边' })).resolves.toMatchObject({
      ok: false,
      reason: 'not-found',
      name: '水边',
      world,
      hint: { code: 'stale-target', next: 'observe' },
    });
    expect(session.near).toHaveBeenCalledOnce();
  });

  it('passes movement arguments through', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.walk, { distance: 3, fast: true });
    await execute(tools.turn, { degrees: 45 });
    const byHeading = (await execute(tools.turn, { heading: -90 })) as Record<string, unknown>;
    await execute(tools.move_to, { x: 1, z: 2, fast: true });
    await execute(tools.approach, { id: 'apple-1', standoff: 0.5, fast: true });
    expect(session.walk).toHaveBeenCalledWith(3, true);
    expect(session.turn).toHaveBeenCalledWith(45);
    expect(session.turnTo).toHaveBeenCalledWith(-90);
    expect(byHeading.heading).toBe(-90);
    expect(session.moveTo).toHaveBeenCalledWith(1, 2, true);
    expect(session.approach).toHaveBeenCalledWith('apple-1', 0.5, true);
  });

  it('turns relative or absolute, but not both', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await expect(execute(tools.turn, {})).resolves.toMatchObject({
      ok: false,
      reason: 'need-turn',
    });
    await expect(execute(tools.turn, { degrees: 10, heading: 0 })).resolves.toMatchObject({
      ok: false,
      reason: 'ambiguous-turn',
    });
    expect(session.turn).not.toHaveBeenCalled();
    expect(session.turnTo).not.toHaveBeenCalled();
  });

  it('uses defaults for optional movement arguments', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.walk, { distance: 3 });
    await execute(tools.move_to, { x: 1, z: 2 });
    await execute(tools.approach, { id: 'apple-1' });
    expect(session.walk).toHaveBeenCalledWith(3, false);
    expect(session.moveTo).toHaveBeenCalledWith(1, 2, false);
    expect(session.approach).toHaveBeenCalledWith('apple-1', undefined, false);
  });

  it('passes item actions through', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.eat, { id: 'apple-1' });
    await execute(tools.eat, {});
    await execute(tools.pick_up, { id: 'apple-1' });
    await execute(tools.pick_up, {});
    await execute(tools.drop, { id: 'apple-1' });
    await execute(tools.drop, {});
    await execute(tools.store, { id: 'apple-1' });
    await execute(tools.store, {});
    await execute(tools.sleep, {});
    await execute(tools.set_height, { level: 0.3 });
    expect(session.eat).toHaveBeenNthCalledWith(1, 'apple-1');
    expect(session.eat).toHaveBeenNthCalledWith(2, undefined);
    expect(session.pickUp).toHaveBeenNthCalledWith(1, 'apple-1');
    expect(session.pickUp).toHaveBeenNthCalledWith(2, undefined);
    expect(session.drop).toHaveBeenNthCalledWith(1, 'apple-1');
    expect(session.drop).toHaveBeenNthCalledWith(2, undefined);
    expect(session.store).toHaveBeenNthCalledWith(1, 'apple-1');
    expect(session.store).toHaveBeenNthCalledWith(2, undefined);
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
