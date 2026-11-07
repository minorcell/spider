const UPSTREAM = 'https://opencode.ai/inference/go';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, accept, x-opencode-session, x-api-key, api-key',
  'Access-Control-Max-Age': '86400',
};

const FORWARDED = ['authorization', 'content-type', 'accept', 'x-api-key', 'api-key'];

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const incoming = new URL(request.url);

    if (incoming.pathname === '/') {
      return new Response('spider inference proxy\n', { headers: CORS });
    }

    const headers = new Headers();
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set(
      'x-opencode-session',
      request.headers.get('x-opencode-session') ?? crypto.randomUUID(),
    );
    headers.set('user-agent', 'spider/0.1');

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + incoming.pathname, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      });
    } catch (error) {
      return Response.json(
        { error: { message: `upstream unreachable: ${error.message}` } },
        { status: 502, headers: CORS },
      );
    }

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('content-length');
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('transfer-encoding');
    for (const [name, value] of Object.entries(CORS)) {
      responseHeaders.set(name, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
