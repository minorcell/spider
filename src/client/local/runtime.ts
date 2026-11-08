import type { MLCEngine } from '@mlc-ai/web-llm';
import { setLocalBusy } from '@/src/client/local/activity';
import { LOCAL_APP_CONFIG } from '@/src/client/local/model';
import { localProgress } from '@/src/client/local/progress';
import { localText } from '@/src/client/local/text';
import { LOCAL_MODEL, type LocalBackend, type LocalStatus } from '@/src/client/local/types';

/** One engine in the journal worker, shared by actions and diary summaries. */
export function createLocalRuntime(): LocalBackend {
  let engine: MLCEngine | null = null;
  let status: LocalStatus = { ready: false, text: '尚未加载本机模型' };
  interface Job {
    id?: string;
    kind: 'action' | 'summary' | 'barrier';
    run(): Promise<void>;
    preempted: boolean;
  }
  const jobs: Job[] = [];
  let draining = false;
  let active: Job | null = null;
  const pending = new Set<string>();
  const cancelled = new Set<string>();
  const sessions = new Set<string>();
  const preemptSummary = (): void => {
    if (active?.kind !== 'summary' || active.preempted) return;
    active.preempted = true;
    void engine?.interruptGenerate().catch(() => undefined);
  };
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (jobs.length) {
        // Loading/unloading is a barrier; inference may only overtake summaries before it.
        const barrier = jobs.findIndex((job) => job.kind === 'barrier');
        const end = barrier < 0 ? jobs.length : barrier;
        const foreground = jobs.findIndex((job, i) => i < end && job.kind === 'action');
        // Do not insert a diary prompt into an action's KV-cache chain while its tool runs.
        const paused = sessions.size > 0 && foreground < 0 && jobs[0].kind === 'summary';
        if (paused && barrier < 0) break;
        active = jobs.splice(paused ? barrier : foreground < 0 ? 0 : foreground, 1)[0];
        setLocalBusy(true);
        await active.run();
        active = null;
      }
    } finally {
      active = null;
      draining = false;
      setLocalBusy(false);
    }
  };
  const serial = <T>(
    work: () => Promise<T>,
    kind: Job['kind'] = 'barrier',
    id?: string,
  ): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        id,
        kind,
        preempted: false,
        async run() {
          job.preempted = false;
          try {
            const value = await work();
            if (job.preempted) jobs.push(job);
            else resolve(value);
          } catch (error) {
            // Retry interrupted background work after the interactive request has finished.
            if (job.preempted && !cancelled.has(id!)) jobs.push(job);
            else reject(error);
          } finally {
            // Publish the idle state before the completion can start a tool animation.
            setLocalBusy(false);
          }
        },
      };
      jobs.push(job);
      if (kind === 'action') preemptSummary();
      void drain();
    });
  };
  return {
    async localSession(id, open) {
      if (open) {
        sessions.add(id);
        preemptSummary();
      } else {
        sessions.delete(id);
        if (jobs.length) void drain();
      }
    },
    localStatus: async () => ({ ...status }),
    localLoad: (options) =>
      serial(async () => {
        if (engine) return;
        const { MLCEngine, hasModelInCache } = await import('@mlc-ai/web-llm');
        if (options?.cachedOnly && !(await hasModelInCache(LOCAL_MODEL, LOCAL_APP_CONFIG)))
          throw new Error('本机模型缓存已清除，请在设置里重新加载本机模型');
        status = { ready: false, text: '正在加载本机模型…' };
        let next: MLCEngine | null = null;
        try {
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
    localComplete(id, messages, options, onDelta) {
      pending.add(id);
      let queuedAt = performance.now();
      let queueMs = 0;
      return serial(
        async () => {
          const startedAt = performance.now();
          queueMs += startedAt - queuedAt;
          try {
            if (cancelled.has(id)) throw new DOMException('已停止', 'AbortError');
            if (!engine) throw new Error('请先在设置里加载本机模型');
            const request = {
              messages,
              temperature: 0,
              max_tokens: options?.kind === 'summary' ? 384 : 256,
              extra_body: { enable_thinking: false, enable_latency_breakdown: true },
            };
            let rawText = '';
            let usage;
            let finishReason;
            let firstTokenMs = 0;
            if (onDelta) {
              const chunks = await engine.chat.completions.create({
                ...request,
                stream: true,
                stream_options: { include_usage: true },
              });
              let buffered = '';
              let lastSent = performance.now();
              for await (const chunk of chunks) {
                if (cancelled.has(id) || active?.preempted) break;
                const delta = chunk.choices[0]?.delta.content ?? '';
                if (delta) {
                  if (!rawText) firstTokenMs = performance.now() - startedAt;
                  rawText += delta;
                  buffered += delta;
                  if (performance.now() - lastSent >= 40 || rawText === delta) {
                    onDelta(buffered);
                    buffered = '';
                    lastSent = performance.now();
                  }
                }
                finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
                if (chunk.usage) usage = chunk.usage;
              }
              if (buffered && !cancelled.has(id) && !active?.preempted) onDelta(buffered);
            } else {
              const result = await engine.chat.completions.create(request);
              rawText = result.choices[0].message.content ?? '';
              usage = result.usage;
              finishReason = result.choices[0].finish_reason;
            }
            if (cancelled.has(id)) throw new DOMException('已停止', 'AbortError');
            if (finishReason === 'length') {
              throw new Error('本机模型的回复达到长度限制，请缩短指令后重试');
            }
            return {
              text: localText(rawText),
              rawText,
              input: usage?.prompt_tokens ?? 0,
              output: usage?.completion_tokens ?? 0,
              metrics: {
                queueMs,
                generationMs: performance.now() - startedAt,
                firstTokenMs:
                  usage?.extra?.time_to_first_token_s == null
                    ? firstTokenMs
                    : usage.extra.time_to_first_token_s * 1000,
                prefillTokensPerSecond: usage?.extra?.prefill_tokens_per_s ?? 0,
                decodeTokensPerSecond: usage?.extra?.decode_tokens_per_s ?? 0,
              },
            };
          } catch (error) {
            if (error instanceof Error && error.name === 'ContextWindowSizeExceededError') {
              throw new Error('本机模型的上下文已满，请发送一条较短的新指令', { cause: error });
            }
            throw error;
          } finally {
            queuedAt = performance.now();
          }
        },
        options?.kind ?? 'action',
        id,
      ).finally(() => {
        pending.delete(id);
        cancelled.delete(id);
      });
    },
    async localCancel(id) {
      if (!pending.has(id)) return;
      cancelled.add(id);
      if (active?.id === id) await engine!.interruptGenerate();
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
