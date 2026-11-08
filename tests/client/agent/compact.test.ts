import type { ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compactSession } from '@/src/client/agent/compact';
import { blankSession, overLimit, SUMMARY_PREFIX } from '@/src/client/journal/session';

const mock = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: mock.generateText,
}));

const messages: ModelMessage[] = [
  { role: 'user', content: '记住不要吃红色的。'.repeat(300) },
  { role: 'assistant', content: '记住了。' },
  { role: 'user', content: '去水边' },
  { role: 'assistant', content: '到了。' },
  { role: 'user', content: '谢谢' },
];
const session = { ...blankSession('2026-11-09'), messages, updatedAt: 123, digestedAt: 100 };
const input = { session, limits: { contextTokens: 1000 }, model: 'test' };

beforeEach(() => {
  mock.generateText
    .mockReset()
    .mockResolvedValue({ text: '用户要求不要吃红色的。', finishReason: 'stop' });
});

describe('context compaction', () => {
  it('skips the model below the threshold, with no limit, or without earlier turns', async () => {
    for (const options of [
      { ...input, limits: { contextTokens: 100_000 } },
      { ...input, limits: { contextTokens: null } },
      { ...input, session: { ...session, messages: messages.slice(0, 2) } },
    ]) {
      expect(await compactSession(options)).toBe(options.session);
    }
    expect(mock.generateText).not.toHaveBeenCalled();
  });

  it('replaces only earlier turns and preserves metadata and the original session', async () => {
    const next = await compactSession(input);
    expect(next).toEqual({
      ...session,
      messages: [
        { role: 'assistant', content: `${SUMMARY_PREFIX}\n用户要求不要吃红色的。` },
        ...messages.slice(2),
      ],
    });
    expect(overLimit(next, input.limits)).toBe(false);
    expect(session.messages).toBe(messages);
    expect(mock.generateText).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        model: 'test',
        messages: [...messages.slice(0, 2), { role: 'user', content: '请总结以上较早的对话。' }],
        maxOutputTokens: 200,
        maxRetries: 0,
        reasoning: 'none',
      }),
    );
    expect(mock.generateText.mock.calls[0][0].tools).toBeUndefined();
  });

  it('includes an existing summary in the next compaction', async () => {
    const prior = { role: 'assistant' as const, content: `${SUMMARY_PREFIX}\n旧的偏好。` };
    const next = await compactSession({
      ...input,
      session: { ...session, messages: [prior, ...messages] },
    });
    expect(mock.generateText.mock.calls[0][0].messages[0]).toBe(prior);
    expect(
      next.messages.filter((message) => String(message.content).startsWith(SUMMARY_PREFIX)),
    ).toHaveLength(1);
  });

  it('retries three times after the initial failure, then continues on success', async () => {
    mock.generateText
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ text: ' ', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: 'incomplete', finishReason: 'length' });
    const next = await compactSession(input);
    expect(next.messages[0].content).toContain('不要吃红色的');
    expect(mock.generateText).toHaveBeenCalledTimes(4);
    for (const [options] of mock.generateText.mock.calls) {
      expect(options.messages).toEqual(mock.generateText.mock.calls[0][0].messages);
    }
  });

  it.each([
    ['a model error', null],
    ['an empty summary', { text: ' ', finishReason: 'stop' }],
    ['an over-limit summary', { text: '长'.repeat(2000), finishReason: 'stop' }],
  ])('preserves every message after exhausting retries for %s', async (_name, result) => {
    if (result) mock.generateText.mockResolvedValue(result);
    else mock.generateText.mockRejectedValue(new Error('offline'));
    await expect(compactSession(input)).rejects.toThrow('已重试 3 次，原始对话已保留');
    expect(mock.generateText).toHaveBeenCalledTimes(4);
    expect(session.messages).toEqual(messages);
  });

  it('does not retry when cancelled before, during, or just after generation', async () => {
    const before = AbortSignal.abort();
    await expect(compactSession({ ...input, signal: before })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mock.generateText).not.toHaveBeenCalled();
    for (const fails of [true, false]) {
      const controller = new AbortController();
      mock.generateText.mockImplementationOnce(async () => {
        controller.abort();
        if (fails) throw new Error('cancelled');
        return { text: '摘要', finishReason: 'stop' };
      });
      await expect(compactSession({ ...input, signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
    }
    expect(mock.generateText).toHaveBeenCalledTimes(2);
    expect(session.messages).toEqual(messages);
  });
});
