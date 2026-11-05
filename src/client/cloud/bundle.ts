import type { MemoryPage } from '../journal/db.js';
import { localDate } from '../../shared/dates.js';
import { classify, type SimBody, type WorldRecord } from '../../shared/sim/snapshot.js';
import { canonicalBytes } from './bytes.js';

export interface CloudBundle {
  format: 1;
  deviceId: string;
  world: SimBody;
  memories: MemoryPage[];
}

export interface CloudLease {
  deviceId: string;
  until: number;
}

export function worldOf(record: WorldRecord): SimBody {
  return {
    seed: record.seed,
    appleIn: record.appleIn,
    sprouts: record.sprouts,
    entities: record.entities,
    marks: record.marks,
    carrying: record.carrying,
    spider: record.spider,
    pending: record.pending,
  };
}

export function bundleBytes(bundle: CloudBundle): Uint8Array {
  return canonicalBytes(bundle);
}

export function parseBundle(bytes: Uint8Array | null): CloudBundle | null {
  if (!bytes || bytes.byteLength === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<CloudBundle>;
  if (raw.format !== 1 || typeof raw.deviceId !== 'string' || raw.deviceId === '') return null;
  if (!raw.world || typeof raw.world !== 'object') return null;
  const world = worldOfRecord(raw.world);
  if (!world) return null;
  if (!Array.isArray(raw.memories)) return null;
  const memories: MemoryPage[] = [];
  for (const page of raw.memories) {
    const parsed = memoryOf(page);
    if (!parsed) return null;
    memories.push(parsed);
  }
  return { format: 1, deviceId: raw.deviceId, world, memories };
}

export function parseLease(bytes: Uint8Array | null): CloudLease | null {
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CloudLease>;
    if (!value || typeof value.deviceId !== 'string' || value.deviceId === '') return null;
    if (typeof value.until !== 'number' || !Number.isFinite(value.until)) return null;
    return { deviceId: value.deviceId, until: value.until };
  } catch {
    return null;
  }
}

function worldOfRecord(world: SimBody): SimBody | null {
  const record = classify({
    ...world,
    id: 'current',
    format: 3,
    savedAt: 1,
    day: localDate(new Date()),
    owner: 'cloud',
    seq: 1,
    leaseUntil: 1,
  });
  return record.status === 'ok' ? worldOf(record.record) : null;
}

function memoryOf(value: unknown): MemoryPage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<MemoryPage>;
  if (typeof raw.date !== 'string' || raw.date === '') return null;
  if (typeof raw.description !== 'string') return null;
  if (typeof raw.noted !== 'string') return null;
  if (typeof raw.summary !== 'string') return null;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;
  return {
    date: raw.date,
    description: raw.description,
    noted: raw.noted,
    summary: raw.summary,
    updatedAt: raw.updatedAt,
  };
}
