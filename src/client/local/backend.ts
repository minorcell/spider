import type { LocalBackend } from './types.js';

let backend: LocalBackend | null = null;
export function useLocalBackend(value: LocalBackend): void {
  backend = value;
}
export async function localBackend(): Promise<LocalBackend> {
  if (!backend)
    throw new Error('本机模型需要后台线程，请等待页面初始化完成；若仍不可用，请使用在线模型');
  return backend;
}
