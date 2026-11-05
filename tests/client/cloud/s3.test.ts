import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  keepaliveObject,
  objectUrl,
  probeEndpoint,
  requestObject,
  strongEtag,
} from '../../../src/client/cloud/s3.js';
import type { CloudSettings } from '../../../src/client/cloud/settings.js';

const settings: CloudSettings = {
  endpoint: 'https://s3.example.com/',
  region: 'us-east-1',
  bucket: 'spider',
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
  ready: true,
};

function response(status: number, etag: string | null, body = 'ok', withBody = true): Response {
  return new Response(withBody ? body : null, {
    status,
    headers: etag ? { etag } : {},
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('object url and etag', () => {
  it('builds a path-style url and keeps only a strong etag', () => {
    expect(objectUrl(settings, 'spider/a b.json')).toBe(
      'https://s3.example.com/spider/spider/a%20b.json',
    );
    expect(strongEtag(null)).toBeNull();
    expect(strongEtag('W/"abc"')).toBeNull();
    expect(strongEtag('"abc"')).toBe('"abc"');
  });
});

describe('requestObject', () => {
  it('signs a put, a get, and a delete', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (init.method === 'GET') return response(200, '"v"', 'hello');
        return response(200, '"v"');
      }),
    );
    const now = new Date('2026-11-06T00:00:00.000Z');
    const put = await requestObject({
      settings,
      method: 'PUT',
      key: 'spider/world.json',
      body: new TextEncoder().encode('{}'),
      match: { kind: 'if-match', etag: '"old"' },
      now,
    });
    expect(put).toMatchObject({ status: 200, etag: '"v"', body: null });
    const putHeaders = calls[0].init.headers as Record<string, string>;
    expect(putHeaders['if-match']).toBe('"old"');
    expect(putHeaders['content-type']).toBe('application/json');
    expect(calls[0].init.keepalive).toBe(false);

    const got = await requestObject({
      settings,
      method: 'GET',
      key: 'spider/world.json',
      match: { kind: 'if-none-match' },
      now,
    });
    expect(new TextDecoder().decode(got.body!)).toBe('hello');
    const getHeaders = calls[1].init.headers as Record<string, string>;
    expect(getHeaders['if-none-match']).toBe('*');

    await requestObject({ settings, method: 'DELETE', key: 'spider/probe.txt' });
    expect(calls[2].init.body).toBeUndefined();
    expect(calls[2].init.method).toBe('DELETE');
  });

  it('drops a weak etag, a missing body, and a failed cancel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(200, 'W/"weak"', '', false)),
    );
    const weak = await requestObject({ settings, method: 'GET', key: 'a' });
    expect(weak.status).toBe(200);
    expect(weak.etag).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 404,
        ok: false,
        headers: { get: () => null },
        body: null,
      })),
    );
    expect(await requestObject({ settings, method: 'PUT', key: 'a' })).toMatchObject({
      status: 404,
      body: null,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 500,
        ok: false,
        headers: { get: () => '"e"' },
        body: { cancel: () => Promise.reject(new Error('cancel')) },
      })),
    );
    expect(await requestObject({ settings, method: 'GET', key: 'a' })).toMatchObject({
      status: 500,
      etag: '"e"',
    });
  });

  it('reports a network failure and fires keepalive without waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await requestObject({ settings, method: 'GET', key: 'a' })).toEqual({
      status: 0,
      etag: null,
      body: null,
    });
    let settle: (init: RequestInit) => void = () => undefined;
    const seen = new Promise<RequestInit>((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        settle(init);
        return response(200, '"k"');
      }),
    );
    keepaliveObject({
      settings,
      method: 'GET',
      key: 'spider/lease.json',
      body: new Uint8Array([1]),
      match: { kind: 'if-none-match' },
    });
    await expect(seen).resolves.toMatchObject({ method: 'PUT', keepalive: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('probeEndpoint', () => {
  function script(steps: Array<Response | 'throw'>): void {
    let index = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const step = steps[index++];
        if (step === 'throw' || !step) throw new Error('offline');
        return step;
      }),
    );
  }

  it('names each reason a probe cannot enable the endpoint', async () => {
    const cases: Array<[Array<Response | 'throw'>, string | null]> = [
      [[response(403, null)], '密钥不对'],
      [['throw'], '连不上端点'],
      [[response(500, null)], '端点拒绝了探测写入'],
      [[response(412, '"p"'), 'throw'], '连不上端点'],
      [[response(200, '"p"'), response(404, null)], '读不回探测文件'],
      [[response(200, '"p"'), response(200, null)], '端点没有返回可用的 ETag'],
      [[response(200, '"p"'), response(200, '"p"'), response(200, '"p"')], '端点没有执行条件写入'],
      [[response(200, '"p"'), response(200, '"p"'), response(500, null)], '条件写入没有返回 412'],
      [[response(200, '"p"'), response(200, '"p"'), response(412, null), 'throw'], '连不上端点'],
      [
        [response(412, '"p"'), response(200, '"p"'), response(412, null), response(200, null)],
        null,
      ],
    ];
    for (const [steps, expected] of cases) {
      script(steps);
      expect(await probeEndpoint(settings)).toBe(expected);
    }
  });
});
