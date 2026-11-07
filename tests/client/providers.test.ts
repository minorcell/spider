import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDERS,
  QUICK_PROVIDERS,
  apiKeyFor,
  discoverModels,
  modelIds,
  modelsURL,
  providerById,
  providerNeedsKey,
} from '../../src/client/providers.js';

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('provider presets', () => {
  it('offers Ollama, DeepSeek, and the custom fallback', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(['ollama', 'deepseek', 'custom']);
    expect(QUICK_PROVIDERS.map((provider) => provider.id)).toEqual(['ollama', 'deepseek']);
    expect(providerById('ollama')).toMatchObject({
      baseURL: 'http://localhost:11434/v1',
      model: '',
      keyless: true,
      discover: true,
      icon: 'terminal',
    });
    expect(providerById('deepseek')).toMatchObject({
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      keyless: false,
      discover: false,
      icon: 'cloud',
    });
    expect(providerById('custom')).toMatchObject({ keyless: false, discover: false });
    expect(providerById('future')).toBeNull();
  });

  it('asks for a Key everywhere except a keyless preset', () => {
    expect(providerNeedsKey('ollama')).toBe(false);
    expect(providerNeedsKey('deepseek')).toBe(true);
    expect(providerNeedsKey('custom')).toBe(true);
    expect(providerNeedsKey('future')).toBe(true);
    expect(providerNeedsKey(undefined)).toBe(true);
  });

  it('puts a placeholder Key on the wire for Ollama', () => {
    expect(apiKeyFor({ provider: 'ollama', apiKey: '' })).toBe('ollama');
    expect(apiKeyFor({ provider: 'deepseek', apiKey: 'secret' })).toBe('secret');
    expect(apiKeyFor({ provider: 'custom', apiKey: 'secret' })).toBe('secret');
    expect(apiKeyFor({ apiKey: 'secret' })).toBe('secret');
  });

  it('points the model list beside the chat path', () => {
    expect(modelsURL('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/models');
    expect(modelsURL('https://example.com/v1///')).toBe('https://example.com/v1/models');
  });
});

describe('model list', () => {
  it('reads OpenAI-compatible ids, skips junk, and removes repeats', () => {
    expect(
      modelIds({
        data: [
          { id: 'llama3.2:latest' },
          { id: '' },
          { id: 7 },
          null,
          { id: 'qwen2.5:7b' },
          { id: 'llama3.2:latest' },
        ],
      }),
    ).toEqual(['llama3.2:latest', 'qwen2.5:7b']);
  });

  it('returns nothing for a body without a list', () => {
    expect(modelIds(null)).toEqual([]);
    expect(modelIds({})).toEqual([]);
    expect(modelIds({ data: 'nope' })).toEqual([]);
  });

  it('lists models without a key', async () => {
    const fetchMock = vi.fn(async () => response({ data: [{ id: 'llama3.2:latest' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverModels('http://localhost:11434/v1', '')).resolves.toEqual([
      'llama3.2:latest',
    ]);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/v1/models', {
      headers: {},
      signal: expect.any(AbortSignal),
    });
  });

  it('sends a key when one is set', async () => {
    const fetchMock = vi.fn(async () => response({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await discoverModels('https://example.com/v1', 'secret');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/v1/models', {
      headers: { authorization: 'Bearer secret' },
      signal: expect.any(AbortSignal),
    });
  });

  it('reports a refused model list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({}, false, 503)),
    );

    await expect(discoverModels('http://localhost:11434/v1', '')).rejects.toThrow(
      '模型列表返回 503',
    );
  });

  it('passes along a network error', async () => {
    const failed = new Error('offline');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(failed)),
    );

    await expect(discoverModels('http://localhost:11434/v1', '')).rejects.toThrow('offline');
  });

  it('gives up when the endpoint never answers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = expect(discoverModels('http://localhost:11434/v1', '')).rejects.toThrow(
      '连接超时',
    );
    await vi.advanceTimersByTimeAsync(5000);

    await pending;
  });
});
