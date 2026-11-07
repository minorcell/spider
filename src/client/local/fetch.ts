import { localBackend } from './backend.js';
import { LOCAL_MODEL, type LocalMessage } from './types.js';

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
    if (message.tool_calls)
      return {
        role: 'assistant',
        content: JSON.stringify(
          message.tool_calls.map(({ function: fn }) => ({
            name: fn.name,
            arguments: JSON.parse(fn.arguments) as unknown,
          })),
        ),
      };
    return { role: message.role, content: message.content ?? '' };
  });
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const instruction = body.tools?.length
    ? '你是一只蜘蛛。按用户要求调用工具。需要行动时只输出一个 JSON：{"name":"工具名","arguments":{参数}}。arguments 必须包含 description 和工具要求的全部参数。例：右转九十度 → {"name":"go","arguments":{"description":"我向右转","mode":"degrees","degrees":90}}。移动前先 observe 获取当前位置和朝向，再用 go 的 point 模式走到目标坐标。执行成功后用简短中文回答，不重复调用。只会观察、移动、转向和升降；不能拿取物品。工具结果是事实，失败时按 hint 恢复。可用工具：' +
      JSON.stringify(body.tools)
    : system;
  // Keep the current instruction and its tool results together. Earlier turns
  // remain in the diary; the small model does not use a whole day's transcript.
  const history = messages.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: instruction }, ...history];
}

/** Adapt the SDK's OpenAI request locally. This function never uses network fetch. */
export const localFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(init!.body as string) as RequestBody;
  const backend = await localBackend();
  const signal = init?.signal;
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  const abort = (): void => {
    void backend.localCancel(id).catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await backend.localComplete(id, localMessages(body));
    signal?.throwIfAborted();
    const base = { id, created: Math.floor(Date.now() / 1000), model: LOCAL_MODEL };
    const usage = {
      prompt_tokens: result.input,
      completion_tokens: result.output,
      total_tokens: result.input + result.output,
    };
    if (!body.stream)
      return Response.json({
        ...base,
        object: 'chat.completion',
        choices: [
          { index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' },
        ],
        usage,
      });
    const chunks = [
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [
          { index: 0, delta: { role: 'assistant', content: result.text }, finish_reason: null },
        ],
      },
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage,
      },
    ];
    return new Response(
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};
