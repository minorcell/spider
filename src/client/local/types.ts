export const LOCAL_MODEL = 'Llama-3.2-1B-Instruct-q0f16-MLC';
export const LOCAL_CONTEXT_TOKENS = 131072;
export type LocalMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'tool'; content: string; tool_call_id: string };
export interface LocalReply {
  text: string;
  rawText?: string;
  input: number;
  output: number;
  metrics?: LocalMetrics;
}
export interface LocalMetrics {
  queueMs: number;
  generationMs: number;
  firstTokenMs: number;
  prefillTokensPerSecond: number;
  decodeTokensPerSecond: number;
}
export interface LocalOptions {
  kind?: 'action' | 'summary';
  generation?: {
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
  };
}
export interface LocalStatus {
  ready: boolean;
  text: string;
  progress?: number;
  detail?: string;
}
export interface LocalBackend {
  localSession?(id: string, active: boolean): Promise<void>;
  localLoad(): Promise<void>;
  localStatus(): Promise<LocalStatus>;
  localComplete(
    id: string,
    messages: LocalMessage[],
    options?: LocalOptions,
    onDelta?: (text: string) => void,
  ): Promise<LocalReply>;
  localCancel(id: string): Promise<void>;
  localUnload(): Promise<void>;
}
