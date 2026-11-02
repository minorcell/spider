import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureBody, type WorldRecord } from '../../../src/shared/sim/snapshot.js';
import { SimSession } from '../../../src/shared/sim/session.js';
import { localDate } from '../../../src/shared/dates.js';
import {
  BUFFER_KEY,
  LEASE_KEY,
  OWNER_KEY,
  bufferPut,
  forgetBuffer,
  forgetLease,
  forgetOwner,
  leaseOf,
  mayWrite,
  migrateWorldKeys,
  pageOwner,
  peekLegacyBuffer,
  readBuffer,
  readLease,
  resetWorldMigration,
  setLease,
} from '../../../src/client/world/storage.js';

function record(over: Partial<WorldRecord> = {}): WorldRecord {
  const body = captureBody(new SimSession(3), null);
  return {
    ...body,
    id: 'current',
    format: 1,
    savedAt: Date.now(),
    day: localDate(new Date()),
    owner: 'owner',
    seq: 1,
    leaseUntil: Date.now() + 60_000,
    ...over,
  };
}

beforeEach(() => {
  resetWorldMigration();
  localStorage.clear();
  sessionStorage.clear();
});

describe('world storage keys', () => {
  it('copies legacy keys and then drops them', () => {
    localStorage.setItem('p5-art.world', 'buffer');
    localStorage.setItem('p5-art.world.lease', 'lease');
    sessionStorage.setItem('p5-art.world.owner', 'tab');
    migrateWorldKeys();
    expect(localStorage.getItem(BUFFER_KEY)).toBe('buffer');
    expect(localStorage.getItem(LEASE_KEY)).toBe('lease');
    expect(sessionStorage.getItem(OWNER_KEY)).toBe('tab');
    expect(localStorage.getItem('p5-art.world')).toBeNull();
  });

  it('keeps a leftover legacy copy when the new key already exists', () => {
    localStorage.setItem(BUFFER_KEY, 'new');
    localStorage.setItem('p5-art.world', 'old');
    migrateWorldKeys();
    expect(localStorage.getItem(BUFFER_KEY)).toBe('new');
    expect(localStorage.getItem('p5-art.world')).toBe('old');
    expect(peekLegacyBuffer()).toBe('old');
  });

  it('runs the copy only once', () => {
    migrateWorldKeys();
    localStorage.setItem('p5-art.world', 'late');
    migrateWorldKeys();
    expect(localStorage.getItem(BUFFER_KEY)).toBeNull();
  });

  it('does nothing when neither key exists', () => {
    migrateWorldKeys();
    expect(localStorage.getItem(BUFFER_KEY)).toBeNull();
  });

  it('swallows a blocked migrate', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => migrateWorldKeys()).not.toThrow();
  });
});

describe('lease and buffer', () => {
  it('reads a valid lease and ignores junk', () => {
    expect(readLease()).toBeNull();
    localStorage.setItem(LEASE_KEY, '{nope');
    expect(readLease()).toBeNull();
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: 1, until: 3 }));
    expect(readLease()).toBeNull();
    setLease('tab', 10);
    expect(readLease()).toEqual({ owner: 'tab', until: 10 });
  });

  it('swallows a blocked lease write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => setLease('tab', 1)).not.toThrow();
  });

  it('takes owner and until from a record', () => {
    const saved = record({ owner: 'a', leaseUntil: 9 });
    expect(leaseOf(saved)).toEqual({ owner: 'a', until: 9 });
    expect(leaseOf()).toBeNull();
  });

  it('writes and reads the buffer', () => {
    const saved = record();
    expect(bufferPut(saved)).toBe(true);
    expect(JSON.parse(String(readBuffer()))).toMatchObject({ seq: 1, owner: 'owner' });
  });

  it('swallows a blocked buffer', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readBuffer()).toBeNull();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(bufferPut(record())).toBe(false);
  });

  it('swallows blocked deletes', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => {
      forgetBuffer();
      forgetLease();
      forgetOwner();
    }).not.toThrow();
  });
});

describe('page owner and write permission', () => {
  it('reuses a stored owner', () => {
    sessionStorage.setItem(OWNER_KEY, 'tab-a');
    expect(pageOwner()).toBe('tab-a');
  });

  it('mints an owner when storage is empty', () => {
    const created = pageOwner();
    expect(created).toEqual(sessionStorage.getItem(OWNER_KEY));
  });

  it('mints an owner when session storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(pageOwner().length).toBeGreaterThan(0);
  });

  it('allows a missing, owned, or expired lease', () => {
    expect(mayWrite(null, 'tab', 10)).toBe(true);
    expect(mayWrite({ owner: 'tab', until: 20 }, 'tab', 10)).toBe(true);
    expect(mayWrite({ owner: 'other', until: 5 }, 'tab', 10)).toBe(true);
    expect(mayWrite({ owner: 'other', until: 20 }, 'tab', 10)).toBe(false);
  });
});
