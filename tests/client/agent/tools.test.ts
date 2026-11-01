import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spiderTools } from '../../../src/client/agent/tools.js';
import type { GoalOutcome, SimSession } from '../../../src/shared/sim/session.js';
import type { Observation } from '../../../src/shared/state.js';
import { GRASS_VIEW, REACH, VIEW_DISTANCE } from '../../../src/shared/world.js';

const observation: Observation = {
  time: 0,
  seed: 1,
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
    carrying: [],
    ahead: { open: 8, by: 'clear', id: null, kind: null },
    nearby: [],
    ways: ['正前方可以走 8 米。'],
    legsLifting: [],
  },
  entities: [],
};

let session: Record<string, ReturnType<typeof vi.fn>>;

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
    walk: vi.fn(async () => outcome()),
    turn: vi.fn(async () => outcome()),
    turnTo: vi.fn(async () => outcome()),
    moveTo: vi.fn(async () => outcome()),
    approach: vi.fn(async () => outcome()),
    eat: vi.fn(async () => outcome()),
    pickUp: vi.fn(async () => outcome()),
    drop: vi.fn(() => outcome()),
    store: vi.fn(() => outcome()),
    sleep: vi.fn(async () => outcome()),
    setHeight: vi.fn(async () => outcome()),
    drive: vi.fn(async () => outcome()),
    wait: vi.fn(async () => outcome()),
  };
});

describe('spiderTools', () => {
  it('offers every action', () => {
    expect(Object.keys(spiderTools(session as unknown as SimSession)).sort()).toEqual([
      'approach',
      'drive',
      'drop',
      'eat',
      'move_to',
      'observe',
      'pick_up',
      'set_height',
      'sleep',
      'store',
      'turn',
      'turn_to',
      'wait',
      'walk',
    ]);
  });

  it('observes and envelopes the result', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    const result = (await execute(tools.observe, { distance: 3 })) as Record<string, unknown>;
    expect(session.observe).toHaveBeenCalledWith(3);
    expect(result).toMatchObject({ ok: true, observation });
    expect(result.ahead).toBe(observation.self.ahead);
    expect(result.nearby).toBe(observation.self.nearby);
    expect(result.ways).toBe(observation.self.ways);
  });

  it('observes the full view when no distance is given', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.observe, {});
    expect(session.observe).toHaveBeenCalledWith(VIEW_DISTANCE);
  });

  it('uses the full view by default and strips the halt field', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    session.walk.mockResolvedValue(outcome({ halt: 'solid', achieved: 1 }));
    const result = (await execute(tools.walk, { distance: 2 })) as Record<string, unknown>;
    expect(session.observe).toHaveBeenCalledWith(VIEW_DISTANCE);
    expect(session.walk).toHaveBeenCalledWith(2, false);
    expect(result).not.toHaveProperty('halt');
    expect(result.achieved).toBe(1);
  });

  it('passes movement arguments through', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.walk, { distance: 3, fast: true });
    await execute(tools.turn, { degrees: 45 });
    await execute(tools.turn_to, { heading: -90 });
    await execute(tools.move_to, { x: 1, z: 2, fast: true });
    await execute(tools.approach, { id: 'apple-1', standoff: 0.5, fast: true });
    expect(session.walk).toHaveBeenCalledWith(3, true);
    expect(session.turn).toHaveBeenCalledWith(45);
    expect(session.turnTo).toHaveBeenCalledWith(-90);
    expect(session.moveTo).toHaveBeenCalledWith(1, 2, true);
    expect(session.approach).toHaveBeenCalledWith('apple-1', 0.5, true);
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

  it('passes drive and wait through', async () => {
    const tools = spiderTools(session as unknown as SimSession);
    await execute(tools.drive, { seconds: 1, throttle: 1, turn: 0.5, lift: -1, boost: 1 });
    await execute(tools.drive, { seconds: 2 });
    await execute(tools.wait, { seconds: 0.5 });
    expect(session.drive).toHaveBeenNthCalledWith(1, 1, {
      throttle: 1,
      turn: 0.5,
      lift: -1,
      boost: 1,
    });
    expect(session.drive).toHaveBeenNthCalledWith(2, 2, {
      throttle: undefined,
      turn: undefined,
      lift: undefined,
      boost: undefined,
    });
    expect(session.wait).toHaveBeenCalledWith(0.5);
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
  });

  it('advertises the sense limits in the observe description', () => {
    const tools = spiderTools(session as unknown as SimSession);
    expect(tools.observe.description).toContain(String(VIEW_DISTANCE));
    expect(tools.observe.description).toContain(String(GRASS_VIEW));
    expect(tools.observe.description).toContain(String(REACH));
  });
});
