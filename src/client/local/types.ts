export const LOCAL_MODEL = 'Qwen3-0.6B-q4f16_1-MLC';
export interface LocalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
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
}
export interface LocalStatus {
  ready: boolean;
  text: string;
  progress?: number;
  detail?: string;
}
export interface LocalBackend {
  localSession?(id: string, active: boolean): Promise<void>;
  localLoad(options?: { cachedOnly?: boolean }): Promise<void>;
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
