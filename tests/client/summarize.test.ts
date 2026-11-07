import { beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', () => ({ generateText: ai.generateText }));

const compat = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: compat.create }));

import { summarizeDiary } from '../../src/client/journal/summarize.js';
import type { PilotSettings } from '../../src/client/settings.js';

const settings: PilotSettings = {
  provider: 'custom',
  baseURL: 'https://example.com',
  model: 'model-1',
  apiKey: 'key',
  contextTokens: null,
  autoMemory: false,
  thinking: true,
};

beforeEach(() => {
  ai.generateText.mockReset();
  ai.generateText.mockResolvedValue({ text: '{"line":"目录句","summary":"一天的摘要"}' });
  compat.create.mockReset();
});

describe('summarizeDiary', () => {
  it('asks the model for a note and reads it back', async () => {
    const provider = vi.fn((model: string) => ({ model }));
    compat.create.mockReturnValue(provider);

    const note = await summarizeDiary({
      settings,
      transcript: '用户：拿苹果',
      noted: '不要吃红的',
      prior: '更早的摘要',
    });

    expect(note).toEqual({ line: '目录句', summary: '一天的摘要' });
    expect(compat.create).toHaveBeenCalledWith({
      name: 'openai-compatible',
      baseURL: 'https://example.com',
      apiKey: 'key',
    });
    expect(provider).toHaveBeenCalledWith('model-1');
    const prompt = String(ai.generateText.mock.calls[0]?.[0]?.prompt);
    expect(prompt).toContain('用户：拿苹果');
    expect(prompt).toContain('不要吃红的');
    expect(prompt).toContain('更早的摘要');
    expect(ai.generateText.mock.calls[0]?.[0]?.reasoning).toBe('provider-default');
  });

  it('turns reasoning off for a summary when thinking is off', async () => {
    compat.create.mockReturnValue(vi.fn(() => 'model-1'));

    await summarizeDiary({
      settings: { ...settings, thinking: false },
      transcript: '对话',
      noted: '',
      prior: '',
    });

    expect(ai.generateText.mock.calls[0]?.[0]?.reasoning).toBe('none');
  });

  it('leaves empty fields blank in the prompt', async () => {
    compat.create.mockReturnValue(vi.fn(() => 'model-1'));

    await summarizeDiary({ settings, transcript: '', noted: '', prior: '' });

    const prompt = String(ai.generateText.mock.calls[0]?.[0]?.prompt);
    expect(prompt).toContain('（无）');
  });

  it('keeps the usage reported with the note', async () => {
    const reported = {
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
      inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 0, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
    };
    ai.generateText.mockResolvedValueOnce({ text: '散文', usage: reported });
    compat.create.mockReturnValue(vi.fn(() => 'model-1'));
    const note = await summarizeDiary({ settings, transcript: '对话', noted: '', prior: '' });
    expect(note).toMatchObject({ line: '散文', summary: '散文', usage: reported });
  });
});

it('keeps diary inference on the local model when local mode is selected', async () => {
  const provider = vi.fn(() => 'local-model');
  compat.create.mockReturnValue(provider);
  await summarizeDiary({
    settings: { ...settings, mode: 'local' },
    transcript: '我往前走了',
    noted: '',
    prior: '',
  });
  expect(compat.create).toHaveBeenCalledWith(
    expect.objectContaining({ baseURL: 'http://local.invalid/v1', fetch: expect.any(Function) }),
  );
  expect(provider).toHaveBeenCalledWith('Qwen3-0.6B-q4f16_1-MLC');
  expect(ai.generateText.mock.calls[0][0].maxRetries).toBe(0);
});
