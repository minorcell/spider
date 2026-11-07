import { expect, it, vi } from 'vitest';
import { runAgent, type AgentEvent } from '../../../src/client/agent/loop.js';
import { useLocalBackend } from '../../../src/client/local/backend.js';
import type { LocalBackend } from '../../../src/client/local/types.js';
import { SimSession } from '../../../src/shared/sim/session.js';

it.each([
  {
    goal: '前进一米',
    name: 'go',
    parameters: { description: '我往前走', mode: 'distance', distance: 1 },
  },
  {
    goal: '后退一米',
    name: 'go',
    parameters: { description: '我往后退', mode: 'distance', distance: -1 },
  },
  {
    goal: '向左转九十度',
    name: 'go',
    parameters: { description: '我向左转', mode: 'degrees', degrees: -90 },
  },
  {
    goal: '向右转九十度',
    name: 'go',
    parameters: { description: '我向右转', mode: 'degrees', degrees: 90 },
  },
  { goal: '把身体抬高', name: 'set_height', parameters: { description: '我抬高身体', level: 0.3 } },
])('executes $goal through the real SDK and simulation', async ({ goal, name, parameters }) => {
  const body = new SimSession(4);
  const original = body.spider.capture();
  const complete = vi
    .fn<LocalBackend['localComplete']>()
    .mockImplementation(async (_id, _messages, _options, onDelta) => {
      const text =
        complete.mock.calls.length === 1 ? JSON.stringify({ name, parameters }) : '答：完成了';
      onDelta?.(text);
      return { text, rawText: text, input: 10, output: 5 };
    });
  useLocalBackend({
    localLoad: vi.fn(),
    localStatus: vi.fn(),
    localUnload: vi.fn(),
    localCancel: vi.fn(),
    localComplete: complete,
  });
  const events: AgentEvent[] = [];
  const timer = setInterval(() => {
    for (let i = 0; i < 30; i++) body.frame(1 / 60);
  }, 0);
  try {
    const result = await runAgent({
      goal,
      session: body,
      settings: {
        provider: 'custom',
        mode: 'local',
        baseURL: '',
        model: '',
        apiKey: '',
        contextTokens: null,
        autoMemory: false,
        thinking: false,
      },
      onEvent: (event) => events.push(event),
    });
    expect(result.text).toBe('完成了');
    expect(complete).toHaveBeenCalledTimes(2);
    const output = events.find((event) => event.type === 'tool-result');
    expect(output).toMatchObject({ name, output: { ok: true } });
    if ('distance' in parameters) {
      const distance = Math.hypot(
        body.spider.root.position.x - original.position.x,
        body.spider.root.position.z - original.position.z,
      );
      expect(distance).toBeGreaterThan(0.8);
    } else if ('degrees' in parameters) {
      expect(Math.abs(body.spider.yaw - original.yaw)).toBeGreaterThan(1.4);
    } else {
      expect(body.spider.heightSet).toBeCloseTo(parameters.level, 1);
    }
  } finally {
    clearInterval(timer);
    body.cancel();
  }
});

it('executes a wrapped local tool call through the real SDK without showing its JSON or result', async () => {
  const raw =
    '<think></think>\n' +
    JSON.stringify({
      tool_calls: [{ function: { name: 'observe', arguments: '{"description":"我看看"}' } }],
    });
  const complete = vi
    .fn<LocalBackend['localComplete']>()
    .mockImplementation(async (_id, _messages, _options, onDelta) => {
      const text = complete.mock.calls.length === 1 ? raw : '答：我已经看清周围了';
      for (const part of [text.slice(0, 15), text.slice(15)]) onDelta?.(part);
      return {
        text: text.replace('<think></think>', '').trim(),
        rawText: text,
        input: 10,
        output: 5,
        metrics: {
          queueMs: 1,
          generationMs: 20,
          firstTokenMs: 5,
          prefillTokensPerSecond: 100,
          decodeTokensPerSecond: 25,
        },
      };
    });
  const session = vi.fn().mockResolvedValue(undefined);
  useLocalBackend({
    localLoad: vi.fn(),
    localStatus: vi.fn(),
    localUnload: vi.fn(),
    localCancel: vi.fn(),
    localComplete: complete,
    localSession: session,
  });
  const events: AgentEvent[] = [];
  const result = await runAgent({
    goal: '看看周围',
    session: new SimSession(1),
    settings: {
      provider: 'custom',
      mode: 'local',
      baseURL: '',
      model: '',
      apiKey: '',
      contextTokens: null,
      autoMemory: false,
      thinking: false,
    },
    onEvent: (event) => events.push(event),
  });
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1][1][2].content).toBe(raw);
  expect(result.text).toBe('我已经看清周围了');
  expect(
    events
      .filter((event) => event.type === 'text')
      .map((event) => event.text)
      .join(''),
  ).toBe('我已经看清周围了');
  expect(events.some((event) => event.type === 'tool-result')).toBe(true);
  expect(result.calls[0].local).toMatchObject({ queueMs: 1, decodeTokensPerSecond: 25 });
  expect(session.mock.calls.map((call) => call[1])).toEqual([true, false]);
});

it('does not hide a successful answer if the worker fails while releasing its session', async () => {
  useLocalBackend({
    localLoad: vi.fn(),
    localStatus: vi.fn(),
    localUnload: vi.fn(),
    localCancel: vi.fn(),
    localComplete: vi.fn().mockResolvedValue({ text: '答：你好', input: 1, output: 1 }),
    localSession: vi.fn(async (_id, open) => {
      if (!open) throw new Error('worker stopped');
    }),
  });
  const result = await runAgent({
    goal: '你好',
    session: new SimSession(1),
    settings: {
      provider: 'custom',
      mode: 'local',
      baseURL: '',
      model: '',
      apiKey: '',
      contextTokens: null,
      autoMemory: false,
      thinking: false,
    },
  });
  expect(result.text).toBe('你好');
});
