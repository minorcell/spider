import { describe, expect, it } from 'vitest';
import { canonicalBytes, progressHash, sha256Hex } from '../../../src/client/cloud/bytes.js';

describe('canonical bytes', () => {
  it('sorts object keys and keeps array order', () => {
    const bytes = canonicalBytes({
      z: 1,
      a: { d: true, b: null },
      m: ['z', { y: 1, x: 'q' }, 2],
    });
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"a":{"b":null,"d":true},"m":["z",{"x":"q","y":1},2],"z":1}',
    );
  });

  it('leaves scalars alone', () => {
    expect(new TextDecoder().decode(canonicalBytes('hi'))).toBe('"hi"');
    expect(new TextDecoder().decode(canonicalBytes(0))).toBe('0');
    expect(new TextDecoder().decode(canonicalBytes(false))).toBe('false');
  });

  it('hashes the empty payload and ignores the device id', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const world = { seed: 1 };
    const memories = [{ date: '2026-11-06' }];
    expect(await progressHash(world, memories)).toBe(await progressHash(world, memories));
    expect(await progressHash(world, memories)).not.toBe(await progressHash({ seed: 2 }, memories));
  });
});
