/** Provider presets. A preset fills the address and says whether a Key is needed. */

import type { IconName } from '../ui/icon/index.js';

export type ProviderId = 'ollama' | 'deepseek' | 'custom';

export interface ModelProvider {
  id: ProviderId;
  name: string;
  summary: string;
  icon: IconName;
  /** Filled into Base URL when the user picks this provider. Empty keeps the field. */
  baseURL: string;
  /** Model filled in for providers that do not list their own models. */
  model: string;
  /** The endpoint answers without an API key. */
  keyless: boolean;
  /** The endpoint can list the models it has. */
  discover: boolean;
}

export const PROVIDERS: readonly ModelProvider[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    summary: '本地运行，不需要 Key',
    icon: 'terminal',
    baseURL: 'http://localhost:11434/v1',
    model: '',
    keyless: true,
    discover: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    summary: '在线接口，填 Key 就行',
    icon: 'cloud',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    keyless: false,
    discover: false,
  },
  {
    id: 'custom',
    name: '自定义',
    summary: 'OpenAI 兼容接口',
    icon: 'gear',
    baseURL: '',
    model: '',
    keyless: false,
    discover: false,
  },
];

/** Presets with a preset address also have a quick-connect flow. */
export const QUICK_PROVIDERS: readonly ModelProvider[] = PROVIDERS.filter(
  (provider) => provider.baseURL !== '',
);

export function providerById(id: string): ModelProvider | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Unknown and custom providers need a Key. Only a known keyless preset does not. */
export function providerNeedsKey(id: string | undefined): boolean {
  return providerById(id ?? '')?.keyless !== true;
}

/** Key put on the wire. A keyless provider gets a placeholder so the SDK sends a header. */
export function apiKeyFor(settings: { provider?: string; apiKey: string }): string {
  return providerNeedsKey(settings.provider) ? settings.apiKey : 'ollama';
}

/** The OpenAI-compatible model list lives beside the chat path. */
export function modelsURL(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`;
}

const LIST_TIMEOUT_MS = 5000;

/** Ask a local endpoint which models it serves. Gives up after a short wait. */
export async function discoverModels(baseURL: string, apiKey: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const response = await fetch(modelsURL(baseURL), {
      headers: apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`模型列表返回 ${response.status}`);
    return modelIds(await response.json());
  } catch (error) {
    if (controller.signal.aborted) throw new Error('连接超时', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Read the OpenAI-compatible `{ data: [{ id }] }` list Ollama serves at /v1/models. */
export function modelIds(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
