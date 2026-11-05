import { describe, expect, it } from 'vitest';
import { bundleBytes, parseBundle, parseLease, worldOf } from '../../../src/client/cloud/bundle.js';
import { progressHash } from '../../../src/client/cloud/bytes.js';
import { captureBody, type WorldRecord } from '../../../src/shared/sim/snapshot.js';
import { SimSession } from '../../../src/shared/sim/session.js';

const memory = {
  date: '2026-11-06',
  description: '水边',
  noted: '叫水边',
  summary: '记住了',
  updatedAt: 5,
};

function sample(deviceId = 'device-a') {
  return {
    format: 1 as const,
    deviceId,
    world: captureBody(new SimSession(4), { text: '去水边', tool: null }),
    memories: [memory],
  };
}

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe('cloud bundle', () => {
  it('strips the lease fields and round-trips a world', async () => {
    const bundle = sample();
    const record: WorldRecord = {
      ...bundle.world,
      id: 'current',
      format: 3,
      savedAt: 9,
      day: '2026-11-06',
      owner: 'tab',
      seq: 3,
      leaseUntil: 99,
    };
    expect(worldOf(record)).toEqual(bundle.world);
    const parsed = parseBundle(bundleBytes(bundle));
    expect(parsed?.deviceId).toBe('device-a');
    expect(parsed?.memories).toEqual([memory]);
    expect(await progressHash(parsed!.world, parsed!.memories)).toBe(
      await progressHash(bundle.world, bundle.memories),
    );
  });

  it('rejects a bundle that is not this format', () => {
    const bundle = sample();
    expect(parseBundle(null)).toBeNull();
    expect(parseBundle(new Uint8Array())).toBeNull();
    expect(parseBundle(bytesOf('{'))).toBeNull();
    expect(parseBundle(bytesOf([]))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, format: 2 }))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, deviceId: '' }))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, world: null }))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, world: { seed: 1 } }))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, memories: null }))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, memories: [null] }))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, memories: [{ ...memory, date: '' }] }))).toBeNull();
    expect(
      parseBundle(bytesOf({ ...bundle, memories: [{ ...memory, description: 1 }] })),
    ).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, memories: [{ ...memory, noted: 1 }] }))).toBeNull();
    expect(parseBundle(bytesOf({ ...bundle, memories: [{ ...memory, summary: 1 }] }))).toBeNull();
    expect(
      parseBundle(bytesOf({ ...bundle, memories: [{ ...memory, updatedAt: Number.NaN }] })),
    ).toBeNull();
  });

  it('reads a lease and rejects a bad one', () => {
    expect(parseLease(null)).toBeNull();
    expect(parseLease(bytesOf('{'))).toBeNull();
    expect(parseLease(bytesOf({ deviceId: '', until: 1 }))).toBeNull();
    expect(parseLease(bytesOf({ deviceId: 'a', until: Number.NaN }))).toBeNull();
    expect(parseLease(bytesOf({ deviceId: 'a', until: 12 }))).toEqual({ deviceId: 'a', until: 12 });
  });
});
