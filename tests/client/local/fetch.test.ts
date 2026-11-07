import { beforeEach, expect, it, vi } from 'vitest';
import { createLocalFetch, localFetch, localMessages } from '../../../src/client/local/fetch.js';
import { localBackend, useLocalBackend } from '../../../src/client/local/backend.js';
import type { LocalBackend } from '../../../src/client/local/types.js';
const backend = {
  localLoad: vi.fn(),
  localStatus: vi.fn(),
  localComplete: vi.fn(),
  localCancel: vi.fn(),
  localUnload: vi.fn(),
} satisfies LocalBackend;
beforeEach(() => {
  vi.resetAllMocks();
  backend.localComplete.mockResolvedValue({ text: '好了', input: 3, output: 2 });
  backend.localCancel.mockResolvedValue(undefined);
  useLocalBackend(backend);
});
it('routes to the selected worker without touching network fetch', async () => {
  const network = vi.spyOn(globalThis, 'fetch');
  expect(await localBackend()).toBe(backend);
  const result = await localFetch('https://should-never-be-used.test', {
    body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }] }),
  });
  expect(await result.json()).toMatchObject({
    choices: [{ message: { content: '好了' } }],
    usage: { total_tokens: 5 },
  });
  expect(network).not.toHaveBeenCalled();
});
it('turns tool results into chat messages and supplies executable tool schemas', () => {
  const messages = localMessages({
    tools: [{ name: 'go' }],
    messages: [
      { role: 'system', content: 'ignored full prompt' },
      { role: 'user', content: '走一步' },
      {
        role: 'assistant',
        tool_calls: [{ function: { name: 'go', arguments: '{"mode":"degrees","degrees":90}' } }],
      },
      { role: 'tool', content: '{"ok":true}' },
      { role: 'assistant', content: null },
    ],
  });
  expect(messages[0].content).toContain('degrees');
  expect(messages[0].content).toContain('前进一米');
  expect(messages[0].content).toContain('"mode":"distance"');
  expect(messages[0].content).toContain('set_height');
  expect(messages[2].content).toContain('"name":"go"');
  expect(messages[3]).toEqual({ role: 'user', content: '工具执行结果：{"ok":true}' });
  expect(messages[4].content).toBe('');
  // Long inputs must be judged by the engine's tokenizer, not a character cutoff.
  expect(
    localMessages({ messages: [{ role: 'user', content: 'x'.repeat(10001) }] })[1].content,
  ).toHaveLength(10001);
  expect(
    localMessages({ tools: [], messages: [{ role: 'system', content: 'summarize' }] })[0].content,
  ).toBe('summarize');
});
it('returns a valid SSE envelope with usage for the existing SDK loop', async () => {
  const res = await localFetch('', { body: JSON.stringify({ stream: true, messages: [] }) });
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  const chunks = (await res.text()).split('\n\n');
  expect(JSON.parse(chunks[0].slice(6)).choices[0].delta.content).toBe('好了');
  expect(JSON.parse(chunks[1].slice(6)).usage.total_tokens).toBe(5);
  expect(chunks[2]).toBe('data: [DONE]');
});

it('delivers real SSE deltas before completion and keeps split reasoning tags hidden', async () => {
  let finish!: (value: unknown) => void;
  backend.localComplete.mockImplementationOnce(
    (_id, _messages, _options, onDelta) =>
      new Promise((resolve) => {
        finish = resolve;
        for (const delta of ['<thi', 'nk>hidden</think> 答：', '我看到了']) onDelta(delta);
      }),
  );
  const response = await createLocalFetch()('', { body: '{"stream":true,"messages":[]}' });
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('答：');
  expect(first).not.toContain('think');
  expect(first).not.toContain('hidden');
  finish({
    text: '答：我看到了',
    rawText: '<think>hidden</think> 答：我看到了',
    input: 3,
    output: 2,
  });
  let tail = '';
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    tail += new TextDecoder().decode(part.value);
  }
  expect(tail).toContain('我看到了');
  expect(tail).toContain('[DONE]');
});

it('restores the exact generated assistant bytes across successive tool steps', async () => {
  const fetcher = createLocalFetch();
  const rawText =
    '<think></think>\n { "name": "go", "arguments": {"mode":"degrees","degrees":90} } ';
  backend.localComplete.mockResolvedValueOnce({
    text: rawText.replace('<think></think>', '').trim(),
    rawText,
    input: 3,
    output: 2,
  });
  const initial = [{ role: 'user', content: '右转' }];
  await fetcher('', { body: JSON.stringify({ tools: [{ name: 'go' }], messages: initial }) });
  const request = {
    tools: [{ name: 'go' }],
    messages: [
      ...initial,
      {
        role: 'assistant',
        tool_calls: [{ function: { name: 'go', arguments: '{"mode":"degrees","degrees":90}' } }],
      },
      { role: 'tool', content: '{"ok":true}' },
    ],
  };
  await fetcher('', { body: JSON.stringify(request) });
  expect(backend.localComplete.mock.calls[1][1][2]).toEqual({
    role: 'assistant',
    content: rawText,
  });
  await createLocalFetch()('', { body: JSON.stringify(request) });
  expect(backend.localComplete.mock.calls[2][1][2].content).not.toBe(rawText);
});

it('retains required description properties while removing schema annotation text', () => {
  const text = localMessages({
    tools: [
      {
        type: 'function',
        function: {
          name: 'observe',
          description: 'verbose tool description',
          parameters: {
            type: 'object',
            required: ['description'],
            properties: {
              description: { type: 'string', description: 'verbose field description' },
            },
          },
        },
      },
    ],
    messages: [],
  })[0].content;
  expect(text).toContain('"properties":{"description":{"type":"string"}}');
  expect(text).not.toContain('verbose');
});
it('cancels the matching generation and never returns an aborted result', async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  backend.localComplete.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  backend.localCancel.mockRejectedValueOnce(new Error('worker closed'));
  const result = localFetch('', { body: '{"messages":[]}', signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(finish).toBeDefined());
  controller.abort();
  finish({ text: 'late', input: 0, output: 0 });
  await rejected;
  expect(backend.localCancel).toHaveBeenCalledWith(backend.localComplete.mock.calls[0][0]);
  await expect(
    localFetch('', { body: '{"messages":[]}', signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(backend.localComplete).toHaveBeenCalledTimes(1);
});
it('reports unavailable workers without importing a main-thread engine', async () => {
  vi.resetModules();
  const bridge = await import('../../../src/client/local/backend.js');
  await expect(bridge.localBackend()).rejects.toThrow('需要后台线程');
});

it('retains multiple native calls instead of collapsing their parameters', () => {
  const messages = localMessages({
    messages: [
      {
        role: 'assistant',
        tool_calls: [
          { function: { name: 'observe', arguments: '{}' } },
          { function: { name: 'go', arguments: '{"mode":"degrees","degrees":90}' } },
        ],
      },
    ],
  });
  expect(JSON.parse(messages[1].content)).toEqual([
    { name: 'observe', arguments: {} },
    { name: 'go', arguments: { mode: 'degrees', degrees: 90 } },
  ]);
});

it('supports a backend without raw history and an empty streamed answer', async () => {
  const fetcher = createLocalFetch();
  await fetcher('', { body: '{"messages":[{"role":"user","content":"hi"}]}' });
  await fetcher('', {
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '好了' },
        { role: 'user', content: 'again' },
      ],
    }),
  });
  expect(backend.localComplete.mock.calls[1][1][2].content).toBe('好了');
  backend.localComplete.mockImplementationOnce(async (_id, _messages, _options, onDelta) => {
    onDelta('');
    return { text: '', input: 0, output: 0 };
  });
  const response = await fetcher('', { body: '{"stream":true,"messages":[]}' });
  expect(await response.text()).toContain('"finish_reason":"stop"');
});

it('propagates a streaming generation error instead of displaying an incomplete action', async () => {
  backend.localComplete.mockRejectedValueOnce(new Error('generation failed'));
  const response = await createLocalFetch()('', { body: '{"stream":true,"messages":[]}' });
  await expect(response.text()).rejects.toThrow('generation failed');
});

it.each([false, true])(
  'ignores late stream work after consumer cancellation (reject=%s)',
  async (reject) => {
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    let delta!: (text: string) => void;
    backend.localComplete.mockImplementationOnce(
      (_id, _messages, _options, onDelta) =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
          delta = onDelta;
        }),
    );
    const response = await createLocalFetch()('', { body: '{"stream":true,"messages":[]}' });
    await response.body!.cancel();
    delta('late');
    if (reject) fail(new Error('late failure'));
    else finish({ text: 'late', input: 0, output: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backend.localCancel).toHaveBeenCalledOnce();
  },
);

it('rejects an aborted stream and ignores deltas sent after abort', async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  let delta!: (text: string) => void;
  backend.localComplete.mockImplementationOnce(
    (_id, _messages, _options, onDelta) =>
      new Promise((resolve) => {
        finish = resolve;
        delta = onDelta;
      }),
  );
  const response = await createLocalFetch()('', {
    body: '{"stream":true,"messages":[]}',
    signal: controller.signal,
  });
  const rejected = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  delta('late');
  finish({ text: 'late', input: 0, output: 0 });
  await rejected;
});
