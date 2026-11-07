export const LOCAL_MODEL = 'Qwen3-0.6B-q4f16_1-MLC';
export interface LocalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface LocalReply {
  text: string;
  input: number;
  output: number;
}
export interface LocalStatus {
  ready: boolean;
  text: string;
  progress?: number;
  detail?: string;
}
export interface LocalBackend {
  localLoad(): Promise<void>;
  localStatus(): Promise<LocalStatus>;
  localComplete(id: string, messages: LocalMessage[]): Promise<LocalReply>;
  localCancel(id: string): Promise<void>;
  localUnload(): Promise<void>;
}
