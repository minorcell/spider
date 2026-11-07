const encoder = new TextEncoder();

export interface SignRequest {
  method: string;
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payload: Uint8Array;
  now: Date;
  headers?: Record<string, string>;
}

export async function signedHeaders(request: SignRequest): Promise<Record<string, string>> {
  const url = new URL(request.url);
  const payloadHash = await sha256Hex(request.payload);
  const stamp = amzStamp(request.now);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp.amz,
  };
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/[ \t]+/g, ' ');
  }

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const signed = names.join(';');
  const canonical = [
    request.method.toUpperCase(),
    canonicalPath(url),
    canonicalQuery(url),
    canonicalHeaders,
    signed,
    payloadHash,
  ].join('\n');
  const scope = `${stamp.day}/${request.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp.amz}\n${scope}\n${await sha256Hex(encoder.encode(canonical))}`;
  const signature = await signatureHex(request.secretAccessKey, stamp.day, request.region, toSign);
  const { host: _host, ...returned } = headers;
  return {
    ...returned,
    authorization: `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}

function canonicalPath(url: URL): string {
  return url.pathname
    .split('/')
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join('/');
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function amzStamp(now: Date): { amz: string; day: string } {
  const amz = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return { amz, day: amz.slice(0, 8) };
}

async function signatureHex(
  secret: string,
  day: string,
  region: string,
  toSign: string,
): Promise<string> {
  let key = await hmac(encoder.encode(`AWS4${secret}`), day);
  key = await hmac(key, region);
  key = await hmac(key, 's3');
  key = await hmac(key, 'aws4_request');
  return hex(await hmac(key, toSign));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
