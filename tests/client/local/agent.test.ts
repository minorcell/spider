import { expect, it, vi } from 'vitest';
import { runAgent, type AgentEvent } from '@/src/client/agent/loop';
import { useLocalBackend } from '@/src/client/local/backend';
import type { LocalBackend } from '@/src/client/local/types';
import { SimSession } from '@/src/shared/sim/session';

it('executes a wrapped local tool call through the real SDK without showing its JSON or result', async () => {
  const raw =
    '<think></think>\n' +
    JSON.stringify({
      tool_calls: [{ function: { name: 'observe', arguments: '{"description":"我看看"}' } }],
    });
  const complete = vi
    .fn<LocalBackend['localComplete']>()
    .mockImplementation(async (_id, _messages, _options, onDelta) => {
      const text = complete.mock.calls.length === 1 ? raw : '我已经看清周围了';
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
    localComplete: vi.fn().mockResolvedValue({ text: '你好', input: 1, output: 1 }),
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

it('streams multiple unmarked prose deltas through the real SDK before inference completes', async () => {
  let delta!: (text: string) => void;
  let finish!: (value: { text: string; input: number; output: number }) => void;
  useLocalBackend({
    localLoad: vi.fn(),
    localStatus: vi.fn(),
    localUnload: vi.fn(),
    localCancel: vi.fn(),
    localComplete: vi.fn((_id, _messages, _options, onDelta) => {
      delta = onDelta!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }),
  });
  const events: AgentEvent[] = [];
  let complete = false;
  const result = runAgent({
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
    onEvent: (event) => events.push(event),
  }).then((reply) => {
    complete = true;
    return reply;
  });
  await vi.waitFor(() => expect(delta).toBeDefined());
  delta('<think>不显示的推理</think>我看到');
  await vi.waitFor(() => expect(events).toContainEqual({ type: 'text', text: '我看到' }));
  expect(complete).toBe(false);
  delta('一棵树。');
  await vi.waitFor(() => expect(events).toContainEqual({ type: 'text', text: '一棵树。' }));
  expect(complete).toBe(false);
  finish({ text: '我看到一棵树。', input: 1, output: 2 });
  expect((await result).text).toBe('我看到一棵树。');
});

it('waits for successful completion before executing even a fully streamed tool object', async () => {
  const world = new SimSession(1);
  const observe = vi.spyOn(world, 'observe');
  const raw = '{"name":"observe","arguments":{"description":"我看看"}}';
  let delta!: (text: string) => void;
  let finish!: (value: { text: string; input: number; output: number }) => void;
  const complete = vi
    .fn<LocalBackend['localComplete']>()
    .mockImplementationOnce((_id, _messages, _options, onDelta) => {
      delta = onDelta!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue({ text: '看到了。', input: 1, output: 2 });
  useLocalBackend({
    localLoad: vi.fn(),
    localStatus: vi.fn(),
    localUnload: vi.fn(),
    localCancel: vi.fn(),
    localComplete: complete,
  });
  const events: AgentEvent[] = [];
  const result = runAgent({
    goal: '看看',
    session: world,
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
  await vi.waitFor(() => expect(delta).toBeDefined());
  delta(raw);
  // Let the real SSE/SDK pipeline consume the whole object while generation remains open.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(observe).not.toHaveBeenCalled();
  expect(events.some((event) => event.type === 'text')).toBe(false);
  finish({ text: raw, input: 1, output: 2 });
  expect((await result).text).toBe('看到了。');
  expect(observe).toHaveBeenCalledOnce();
});
