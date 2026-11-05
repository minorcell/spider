import { describe, expect, it } from 'vitest';
import { signedHeaders } from '../../../src/client/cloud/sigv4.js';

describe('SigV4', () => {
  it('matches the AWS GET Object test vector', async () => {
    const headers = await signedHeaders({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      payload: new Uint8Array(),
      now: new Date('2013-05-24T00:00:00.000Z'),
      headers: { Range: 'bytes=0-9' },
    });
    expect(headers.host).toBeUndefined();
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
    expect(headers['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('signs a sorted query and collapses header space', async () => {
    const headers = await signedHeaders({
      method: 'put',
      url: 'https://s3.example.com/bucket/a%20b?b=1&a=2&a=3&c=4',
      region: 'auto',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      payload: new TextEncoder().encode('{}'),
      now: new Date('2026-11-06T01:02:03.000Z'),
      headers: { 'Content-Type': '  application/json   ; charset=utf-8  ' },
    });
    expect(headers['content-type']).toBe('application/json ; charset=utf-8');
    expect(headers.authorization).toContain('SignedHeaders=');
    expect(headers.host).toBeUndefined();
  });

  it('signs a request that adds no extra headers', async () => {
    const headers = await signedHeaders({
      method: 'DELETE',
      url: 'https://s3.example.com/bucket/spider/probe.txt',
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      payload: new Uint8Array(),
      now: new Date('2026-11-06T00:00:00.000Z'),
    });
    expect(headers.authorization).toContain('Signature=');
    expect(headers['x-amz-date']).toBe('20261106T000000Z');
  });
});
