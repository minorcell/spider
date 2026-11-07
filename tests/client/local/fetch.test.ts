import { beforeEach, expect, it, vi } from 'vitest';
import { localFetch, localMessages } from '../../../src/client/local/fetch.js';
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
