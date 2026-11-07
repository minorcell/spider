import type { CloudSettings } from './settings.js';
import { signedHeaders } from './sigv4.js';

export interface ObjectResult {
  status: number;
  etag: string | null;
  body: Uint8Array | null;
}

export type ObjectMatch = { kind: 'if-match'; etag: string } | { kind: 'if-none-match' };

export interface ObjectRequest {
  settings: CloudSettings;
  method: 'GET' | 'PUT' | 'DELETE';
  key: string;
  body?: Uint8Array;
  match?: ObjectMatch;
  now?: Date;
  keepalive?: boolean;
}

const encoder = new TextEncoder();

export function objectUrl(settings: CloudSettings, key: string): string {
  const endpoint = settings.endpoint.replace(/\/+$/, '');
  const path = [settings.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
  return `${endpoint}/${path}`;
}

export function strongEtag(etag: string | null): string | null {
  if (!etag || etag.startsWith('W/')) return null;
  return etag;
}

export async function requestObject(request: ObjectRequest): Promise<ObjectResult> {
  const body = request.body ?? new Uint8Array();
  const extra: Record<string, string> = {};
  if (request.method === 'PUT') extra['content-type'] = 'application/json';
  if (request.match?.kind === 'if-match') extra['if-match'] = request.match.etag;
  if (request.match?.kind === 'if-none-match') extra['if-none-match'] = '*';
  try {
    const headers = await signedHeaders({
      method: request.method,
      url: objectUrl(request.settings, request.key),
      region: request.settings.region,
      accessKeyId: request.settings.accessKeyId,
      secretAccessKey: request.settings.secretAccessKey,
      payload: body,
      now: request.now ?? new Date(),
      headers: extra,
    });
    const response = await fetch(objectUrl(request.settings, request.key), {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? Uint8Array.from(body) : undefined,
      keepalive: request.keepalive === true,
      cache: 'no-store',
    });
    const etag = strongEtag(response.headers.get('etag'));
    if (request.method !== 'GET' || !response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, etag, body: null };
    }
    return { status: response.status, etag, body: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    return { status: 0, etag: null, body: null };
  }
}

export function keepaliveObject(request: ObjectRequest): void {
  void requestObject({ ...request, method: 'PUT', keepalive: true });
}

export async function probeEndpoint(settings: CloudSettings): Promise<string | null> {
  const key = 'spider/probe.txt';
  const created = await requestObject({
    settings,
    method: 'PUT',
    key,
    body: encoder.encode('ok'),
    match: { kind: 'if-none-match' },
  });
  if (created.status === 403) return '密钥不对';
  if (created.status === 0) return '连不上端点';
  if (created.status !== 200 && created.status !== 412) return '端点拒绝了探测写入';
  const got = await requestObject({ settings, method: 'GET', key });
  if (got.status === 0) return '连不上端点';
  if (got.status !== 200) return '读不回探测文件';
  if (!got.etag) return '端点没有返回可用的 ETag';
  const rejected = await requestObject({
    settings,
    method: 'PUT',
    key,
    body: encoder.encode('no'),
    match: { kind: 'if-match', etag: '"deadbeef"' },
  });
  if (rejected.status === 200) return '端点没有执行条件写入';
  if (rejected.status !== 412) return '条件写入没有返回 412';
  const removed = await requestObject({ settings, method: 'DELETE', key });
  if (removed.status === 0) return '连不上端点';
  return null;
}
