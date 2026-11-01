import { beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', () => ({ generateText: ai.generateText }));

const compat = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: compat.create }));

import { summarizeDiary } from '../../src/client/journal/summarize.js';
import type { PilotSettings } from '../../src/client/settings.js';

const settings: PilotSettings = {
  baseURL: 'https://example.com',
  model: 'model-1',
  apiKey: 'key',
  contextTokens: null,
  compact: false,
  compactKb: null,
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
  });

  it('leaves empty fields blank in the prompt', async () => {
    compat.create.mockReturnValue(vi.fn(() => 'model-1'));

    await summarizeDiary({ settings, transcript: '', noted: '', prior: '' });

    const prompt = String(ai.generateText.mock.calls[0]?.[0]?.prompt);
    expect(prompt).toContain('（无）');
  });
});
