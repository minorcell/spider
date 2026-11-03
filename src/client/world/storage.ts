import type { WorldRecord } from '../../shared/sim/snapshot.js';

export const BUFFER_KEY = 'spider.world';
export const OWNER_KEY = 'spider.world.owner';
export const LEASE_KEY = 'spider.world.lease';

export interface Lease {
  owner: string;
  until: number;
}

export function readLease(): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Lease>;
    if (typeof parsed.owner !== 'string' || !Number.isFinite(parsed.until)) return null;
    return { owner: parsed.owner, until: parsed.until as number };
  } catch {
    return null;
  }
}

export function setLease(page: string, until: number): void {
  try {
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: page, until }));
  } catch {
    // The snapshot still carries an owner and a lease.
  }
}

export function leaseOf(record?: WorldRecord): Lease | null {
  return record ? { owner: record.owner, until: record.leaseUntil } : null;
}

export function readBuffer(): unknown {
  try {
    return localStorage.getItem(BUFFER_KEY);
  } catch {
    return null;
  }
}

export function bufferPut(record: WorldRecord): boolean {
  try {
    localStorage.setItem(BUFFER_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function forgetBuffer(): void {
  try {
    localStorage.removeItem(BUFFER_KEY);
  } catch {
    // Leave a blocked buffer alone.
  }
}

export function forgetLease(): void {
  try {
    localStorage.removeItem(LEASE_KEY);
  } catch {
    // A blocked buffer is replaced by the next write anyway.
  }
}

export function forgetOwner(): void {
  try {
    sessionStorage.removeItem(OWNER_KEY);
  } catch {
    // A blocked session store just means the next launch mints an owner.
  }
}

export function pageOwner(): string {
  try {
    const saved = sessionStorage.getItem(OWNER_KEY);
    if (saved) return saved;
    const created = globalThis.crypto.randomUUID();
    sessionStorage.setItem(OWNER_KEY, created);
    return created;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

export function mayWrite(lease: Lease | null, page: string, now: number): boolean {
  if (!lease) return true;
  if (lease.owner === page) return true;
  return lease.until <= now;
}
