import type { MLCEngine } from '@mlc-ai/web-llm';
import { LOCAL_APP_CONFIG } from './model.js';
import { localProgress } from './progress.js';
import { LOCAL_MODEL, type LocalBackend, type LocalStatus } from './types.js';

/** One engine in the journal worker, shared by actions and diary summaries. */
export function createLocalRuntime(): LocalBackend {
  let engine: MLCEngine | null = null;
  let status: LocalStatus = { ready: false, text: '尚未加载本机模型' };
  let queue = Promise.resolve();
  let active: string | null = null;
  const pending = new Set<string>();
  const cancelled = new Set<string>();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const task = queue.then(work);
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
  return {
    localStatus: async () => ({ ...status }),
    localLoad: () =>
      serial(async () => {
        if (engine) return;
        status = { ready: false, text: '正在加载本机模型…' };
        let next: MLCEngine | null = null;
        try {
          const { MLCEngine } = await import('@mlc-ai/web-llm');
          next = new MLCEngine({
            appConfig: LOCAL_APP_CONFIG,
            initProgressCallback: (report) => {
              status = localProgress(report);
            },
          });
          await next.reload(LOCAL_MODEL, { context_window_size: 4096 });
          engine = next;
          status = { ready: true, text: '本机模型已就绪', progress: 1 };
        } catch (error) {
          await next?.unload().catch(() => undefined);
          status = { ready: false, text: '加载失败，请检查网络、存储空间和浏览器支持后重试' };
          throw error;
        }
      }),
    localComplete(id, messages) {
      pending.add(id);
      return serial(async () => {
        try {
          if (cancelled.has(id)) throw new DOMException('已停止', 'AbortError');
          if (!engine) throw new Error('请先在设置里加载本机模型');
          active = id;
          const result = await engine.chat.completions.create({
            messages,
            temperature: 0,
            max_tokens: 384,
            extra_body: { enable_thinking: false },
          });
          if (cancelled.has(id)) throw new DOMException('已停止', 'AbortError');
          if (result.choices[0].finish_reason === 'length') {
            throw new Error('本机模型的回复达到长度限制，请缩短指令后重试');
          }
          return {
            text: (result.choices[0].message.content ?? '')
              .replace(/<think>[\s\S]*?<\/think>/g, '')
              .trim(),
            input: result.usage!.prompt_tokens,
            output: result.usage!.completion_tokens,
          };
        } catch (error) {
          if (error instanceof Error && error.name === 'ContextWindowSizeExceededError') {
            throw new Error('本机模型的上下文已满，请发送一条较短的新指令', { cause: error });
          }
          throw error;
        } finally {
          active = null;
          pending.delete(id);
          cancelled.delete(id);
        }
      });
    },
    async localCancel(id) {
      if (!pending.has(id)) return;
      cancelled.add(id);
      if (active === id) await engine!.interruptGenerate();
    },
    localUnload: () =>
      serial(async () => {
        await engine?.unload();
        engine = null;
        status = { ready: false, text: '已释放运行时缓存，已下载的模型仍保留' };
      }),
  };
}
export const localRuntime = createLocalRuntime();
