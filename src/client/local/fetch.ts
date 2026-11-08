import { localBackend } from '@/src/client/local/backend';
import { parseInlineCalls } from '@/src/client/agent/inline';
import { localText } from '@/src/client/local/text';
import {
  LOCAL_MODEL,
  type LocalMessage,
  type LocalOptions,
  type LocalReply,
} from '@/src/client/local/types';

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: { function: { name: string; arguments: string } }[];
}
interface RequestBody {
  messages: Message[];
  tools?: unknown[];
  stream?: boolean;
}

export function localMessages(body: RequestBody): LocalMessage[] {
  const messages: LocalMessage[] = body.messages.map((message) => {
    if (message.role === 'tool')
      return { role: 'user', content: `工具执行结果：${message.content}` };
    if (message.tool_calls?.length)
      return {
        role: 'assistant',
        content: JSON.stringify(
          singleOrMany(
            message.tool_calls.map(({ function: fn }) => ({
              name: fn.name,
              arguments: JSON.parse(fn.arguments) as unknown,
            })),
          ),
        ),
      };
    return { role: message.role, content: message.content ?? '' };
  });
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const instruction = body.tools?.length
    ? '你是一只蜘蛛。按用户要求调用工具。需要行动时只输出一个 JSON：{"name":"工具名","arguments":{参数}}。arguments 必须包含 description 和工具要求的全部参数。例：右转九十度 → {"name":"go","arguments":{"description":"我向右转","mode":"degrees","degrees":90}}。移动前先 observe 获取当前位置和朝向，再用 go 的 point 模式走到目标坐标。执行成功后用简短中文回答，不重复调用。只会观察、移动、转向和升降；不能拿取物品。工具结果是事实，失败时按 hint 恢复。' +
      'description 用20字内第一人称短句。go 的 point 用 x、z 坐标，id 用对象 id；heading 是绝对角度，0 朝 -Z，degrees 是顺时针相对角度。set_height 的 level 是离地高度。observe 不填 distance 就尽量看远。' +
      '无需行动时，以“答：”开头简短回答。不要复述工具 JSON 或工具结果。可用工具：' +
      JSON.stringify(body.tools.map((tool) => compactTool(tool)))
    : system;
  // Keep the current instruction and its tool results together. Earlier turns
  // remain in the diary; the small model does not use a whole day's transcript.
  const history = messages.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: instruction }, ...history];
}

/** Adapt the SDK's OpenAI request locally. This function never uses network fetch. */
export function createLocalFetch(options: LocalOptions = {}): typeof fetch {
  // One closure per agent run: retain exact model history, without keeping old runs alive.
  let previous: { canonical: LocalMessage[]; sent: LocalMessage[]; reply: LocalReply } | undefined;
  return async (_url, init) => {
    const body = JSON.parse(init!.body as string) as RequestBody;
    const backend = await localBackend();
    const signal = init?.signal;
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const canonical = localMessages(body);
    let messages = canonical;
    if (previous) {
      const count = previous.canonical.length;
      const next = canonical[count];
      const names = parseInlineCalls(previous.reply.text, ['observe', 'go', 'set_height']);
      const normalized = names.length
        ? JSON.stringify(
            singleOrMany(
              names.map((call) => ({
                name: call.name,
                arguments: call.input,
              })),
            ),
          )
        : previous.reply.text;
      if (
        next?.role === 'assistant' &&
        next.content === normalized &&
        previous.canonical.every(
          (message, i) =>
            message.role === canonical[i]?.role && message.content === canonical[i]?.content,
        )
      ) {
        messages = [
          ...previous.sent,
          { role: 'assistant', content: previous.reply.rawText ?? previous.reply.text },
          ...canonical.slice(count + 1),
        ];
      }
    }
    const remember = (reply: LocalReply): void => {
      previous = { canonical, sent: messages, reply };
    };
    const abort = (): void => {
      void backend.localCancel(id).catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = (): void => signal?.removeEventListener('abort', abort);
    const base = { id, created: Math.floor(Date.now() / 1000), model: LOCAL_MODEL };
    const usageOf = (result: LocalReply) => ({
      prompt_tokens: result.input,
      completion_tokens: result.output,
      total_tokens: result.input + result.output,
    });
    if (!body.stream)
      try {
        const result = await backend.localComplete(id, messages, options);
        signal?.throwIfAborted();
        remember(result);
        return Response.json({
          ...base,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: result.text },
              finish_reason: 'stop',
            },
          ],
          usage: usageOf(result),
          local_metrics: result.metrics,
        });
      } finally {
        cleanup();
      }
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let raw = '';
        let sent = '';
        const push = (chunk: unknown): void => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        };
        const delta = (visible: string): void => {
          const text = visible.slice(sent.length);
          if (!text) return;
          sent = visible;
          push({
            ...base,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          });
        };
        void backend
          .localComplete(id, messages, options, (text) => {
            if (closed || signal?.aborted) return;
            raw += text;
            delta(localText(raw, false));
          })
          .then((result) => {
            signal?.throwIfAborted();
            if (closed) return;
            remember(result);
            delta(result.text);
            push({
              ...base,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: usageOf(result),
              local_metrics: result.metrics,
            });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            closed = true;
            controller.close();
          })
          .catch((error: unknown) => {
            if (closed) return;
            closed = true;
            controller.error(error);
          })
          .finally(cleanup);
      },
      cancel() {
        closed = true;
        cleanup();
        return backend.localCancel(id);
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
}

export const localFetch = createLocalFetch();

function singleOrMany<T>(items: T[]): T | T[] {
  return items.length === 1 ? items[0] : items;
}

/** Descriptions and validation remain in the SDK; send only the executable schema. */
function compactTool(value: unknown, properties = false): unknown {
  if (Array.isArray(value)) return value.map((item) => compactTool(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => properties || (key !== 'description' && key !== '$schema'))
      .map(([key, item]) => [key, compactTool(item, key === 'properties')]),
  );
}
