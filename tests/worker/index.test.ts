// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index.js';

const UPSTREAM = 'https://opencode.ai/inference/go';

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  upstream = vi.fn(
    async () =>
      new Response('up', {
        status: 201,
        statusText: 'Created',
        headers: {
          'content-length': '2',
          'content-encoding': 'gzip',
          'transfer-encoding': 'chunked',
          'x-upstream': 'yes',
        },
      }),
  );
  vi.stubGlobal('fetch', upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inference proxy worker', () => {
  it('answers a CORS preflight without calling upstream', async () => {
    const response = await worker.fetch(
      new Request('https://proxy.example/inference/go', { method: 'OPTIONS' }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('greets at the root', async () => {
    const response = await worker.fetch(new Request('https://proxy.example/'));
    expect(await response.text()).toBe('spider inference proxy\n');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards a POST with its body and headers', async () => {
    const request = new Request('https://proxy.example/inference/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer key',
        'x-api-key': 'api-key',
        accept: 'application/json',
        'x-opencode-session': 'session-1',
      },
      body: '{"model":"x"}',
    });
    const response = await worker.fetch(request);

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${UPSTREAM}/inference/chat/completions`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer key');
    expect(headers.get('x-api-key')).toBe('api-key');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('x-opencode-session')).toBe('session-1');
    expect(headers.get('user-agent')).toBe('spider/0.1');
    expect(init.body).toBeInstanceOf(ReadableStream);

    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(await response.text()).toBe('up');
    expect(response.headers.get('x-upstream')).toBe('yes');
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('mints a session id when none is sent', async () => {
    await worker.fetch(
      new Request('https://proxy.example/inference/x', { method: 'POST', body: '{}' }),
    );
    const headers = (upstream.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
    expect(headers.get('x-opencode-session')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('sends no body for GET and HEAD', async () => {
    await worker.fetch(new Request('https://proxy.example/inference/x', { method: 'GET' }));
    await worker.fetch(new Request('https://proxy.example/inference/x', { method: 'HEAD' }));
    for (const call of upstream.mock.calls) {
      expect((call as [string, RequestInit])[1].body).toBeUndefined();
    }
  });

  it('reports an unreachable upstream', async () => {
    upstream.mockRejectedValue(new Error('boom'));
    const response = await worker.fetch(
      new Request('https://proxy.example/inference/x', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(502);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({
      error: { message: 'upstream unreachable: boom' },
    });
  });
});
