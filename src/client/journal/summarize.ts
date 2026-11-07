import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModelUsage } from 'ai';
import { apiKeyFor } from '../providers.js';
import { reasoningOf, type PilotSettings } from '../settings.js';

export interface DiaryNote {
  line: string;
  summary: string;
  usage?: LanguageModelUsage;
}

export async function summarizeDiary(input: {
  settings: PilotSettings;
  transcript: string;
  noted: string;
  prior: string;
}): Promise<DiaryNote> {
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: input.settings.baseURL,
    apiKey: apiKeyFor(input.settings),
  });
  const result = await generateText({
    model: provider(input.settings.model),
    system:
      '你在整理一只蜘蛛某一天的日记。只根据给出的对话，不要编造。不要写坐标。用 JSON 回答，不要写别的。',
    prompt: [
      `已经明确记下的话，不要改写进 summary，它们会单独留着：`,
      input.noted || '（无）',
      '',
      '更早的摘要：',
      input.prior || '（无）',
      '',
      '对话：',
      input.transcript || '（无）',
      '',
      '回答 {"line":"目录上一句，让以后能决定要不要翻开这一天","summary":"这一天发生了什么"}',
    ].join('\n'),
    reasoning: reasoningOf(input.settings),
  });
  const note = readNote(result.text);
  return result.usage == null ? note : { ...note, usage: result.usage };
}

export function readNote(text: string): DiaryNote {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        line?: unknown;
        summary?: unknown;
      };
      const line = typeof parsed.line === 'string' ? parsed.line.trim() : '';
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
      if (line || summary) return { line: line.slice(0, 80), summary };
    } catch {}
  }
  const summary = text.trim();
  return { line: summary.slice(0, 40), summary };
}
