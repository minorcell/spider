import type { WorldRecord } from '../../shared/sim/snapshot.js';

export const BUFFER_KEY = 'spider.world';
export const OWNER_KEY = 'spider.world.owner';
export const LEASE_KEY = 'spider.world.lease';

const LEGACY_BUFFER = 'p5-art.world';
const LEGACY_OWNER = 'p5-art.world.owner';
const LEGACY_LEASE = 'p5-art.world.lease';

export interface Lease {
  owner: string;
  until: number;
}

let migrated = false;

function copyKey(storage: Storage, from: string, to: string): void {
  if (storage.getItem(to) != null) return;
  const legacy = storage.getItem(from);
  if (legacy == null) return;
  storage.setItem(to, legacy);
  storage.removeItem(from);
}

/** Copy the previous p5-art keys once when the new key is empty. */
export function migrateWorldKeys(): void {
  if (migrated) return;
  try {
    copyKey(localStorage, LEGACY_BUFFER, BUFFER_KEY);
    copyKey(localStorage, LEGACY_LEASE, LEASE_KEY);
    copyKey(sessionStorage, LEGACY_OWNER, OWNER_KEY);
  } catch {
    // A blocked store is read as empty on the next launch.
  }
  migrated = true;
}

/** Tests re-run migration against a fresh store. */
export function resetWorldMigration(): void {
  migrated = false;
}

/** The leftover p5-art buffer, if a new-key value failed to classify. */
export function peekLegacyBuffer(): unknown {
  try {
    return localStorage.getItem(LEGACY_BUFFER);
  } catch {
    return null;
  }
}

export function readLease(): Lease | null {
  migrateWorldKeys();
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
  migrateWorldKeys();
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
  migrateWorldKeys();
  try {
    return localStorage.getItem(BUFFER_KEY);
  } catch {
    return null;
  }
}

export function bufferPut(record: WorldRecord): boolean {
  migrateWorldKeys();
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
  migrateWorldKeys();
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
