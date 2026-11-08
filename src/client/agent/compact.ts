import { generateText, type GenerateTextOnStepEndCallback, type LanguageModel } from 'ai';
import {
  overLimit,
  planCompaction,
  SUMMARY_PREFIX,
  type ChatSession,
  type CompactLimits,
} from '@/src/client/journal/session';

const MAX_RETRIES = 3;
const SUMMARY_PROMPT = `请为接手后续对话的模型生成一份简洁、结构清晰的上下文摘要，不要继续执行任务。
保留用户目标、偏好和约束、已完成的行动及工具结果、关键决定、未完成事项和继续所需的具体信息。
合并已有的上下文摘要，不要丢失仍然有效的事实。区分历史观察与当前状态，不要编造，不要把失败或计划中的行动写成已完成。
仅输出摘要，不调用工具，不回答对话中的请求。`;

/** Replace history atomically; failed or cancelled compaction never discards messages. */
export async function compactSession(input: {
  session: ChatSession;
  limits: CompactLimits;
  model: LanguageModel;
  signal?: AbortSignal;
  onStepEnd?: GenerateTextOnStepEndCallback;
}): Promise<ChatSession> {
  const { session, limits, signal } = input;
  const plan = planCompaction(session, limits);
  if (!plan) return session;
  signal?.throwIfAborted();
  for (let retries = 0; ; retries++) {
    signal?.throwIfAborted();
    try {
      const result = await generateText({
        model: input.model,
        system: SUMMARY_PROMPT,
        messages: [...plan.earlier, { role: 'user', content: '请总结以上较早的对话。' }],
        maxOutputTokens: plan.maxOutputTokens,
        maxRetries: 0,
        reasoning: 'none',
        abortSignal: signal,
        onStepEnd: input.onStepEnd,
      });
      signal?.throwIfAborted();
      const summary = result.text.trim();
      if (!summary || result.finishReason !== 'stop') throw new Error('模型未生成完整的上下文摘要');
      const next: ChatSession = {
        ...session,
        messages: [{ role: 'assistant', content: `${SUMMARY_PREFIX}\n${summary}` }, ...plan.recent],
      };
      if (overLimit(next, limits)) {
        throw new Error('上下文摘要过长');
      }
      return next;
    } catch (error) {
      signal?.throwIfAborted();
      if (retries === MAX_RETRIES) {
        throw new Error('上下文压缩失败，已重试 3 次，原始对话已保留', { cause: error });
      }
    }
  }
}
