// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { localDate } from '../../../src/shared/dates.js';
import { SimSession } from '../../../src/shared/sim/session.js';
import { Terrain } from '../../../src/shared/terrain.js';
import { APPLE_EVERY } from '../../../src/shared/world.js';
import {
  applyBody,
  captureBody,
  chooseRecord,
  classify,
  FORMAT,
  newer,
  type WorldRecord,
} from '../../../src/shared/sim/snapshot.js';

const today = '2026-11-02';

it('plants a body on a terrain that was already baked', () => {
  const session = new SimSession(1);
  const baked = new Terrain(2);
  applyBody(session, captureBody(new SimSession(2), null), baked);
  expect(session.world.terrain).toBe(baked);
  expect(session.world.seed).toBe(2);
});

function session(): SimSession {
  return new SimSession(7);
}

function good(): WorldRecord {
  const body = captureBody(session(), { text: '去巢边', tool: null });
  return {
    ...body,
    id: 'current',
    format: 3,
    savedAt: 1_700_000_000_000,
    day: today,
    owner: 'tab',
    seq: 2,
    leaseUntil: 1_700_000_006_000,
  };
}

describe('snapshot', () => {
  it.each([1, 2])('migrates format %s with the original optional fields absent', (format) => {
    const base = good();
    const entities = base.entities.map(({ id, kind, x, y, z, stage, footprint }) => ({
      id,
      kind,
      x,
      y,
      z,
      stage,
      footprint,
    }));
    const carried = entities.find((entity) => entity.kind === 'apple')!;
    const legacy = {
      ...base,
      format,
      day: '2020-01-01',
      entities: entities.filter((entity) => entity.id !== carried.id),
      carrying: [carried],
      pending: { text: '带回去' },
    };
    const parsed = classify(JSON.stringify(legacy), today);

    expect(parsed).toMatchObject({ status: 'ok', migrated: true });
    if (parsed.status !== 'ok') return;
    expect(parsed.record).toEqual({
      ...legacy,
      format: FORMAT,
      pending: { text: '带回去', tool: null },
    });
    expect(parsed.record.carrying[0]).not.toHaveProperty('vx');
    expect(parsed.record.carrying[0]).not.toHaveProperty('qx');
    expect(legacy.format).toBe(format);
    expect(classify(parsed.record, today)).not.toHaveProperty('migrated');
  });

  it.each([1, 2])('validates format %s before migrating it', (format) => {
    const base = { ...good(), format };
    const badEntity = { ...base.entities[0], x: Number.NaN };

    expect(classify({ ...base, spider: { ...base.spider, feet: [] } }, today).status).toBe(
      'malformed',
    );
    expect(classify({ ...base, entities: [badEntity] }, today).status).toBe('malformed');
    expect(classify({ ...base, appleIn: -1 }, today).status).toBe('malformed');
    expect(classify({ ...base, pending: undefined }, today)).toMatchObject({
      status: 'ok',
      migrated: true,
      record: { pending: null },
    });
  });

  it('keeps a pose that sits past the island rim', () => {
    const record = good();
    record.spider.feet[0].x = 40;
    record.entities[1].x = 400;
    expect(classify(record, today).status).toBe('ok');
    record.spider.feet[0].x = 1_000_001;
    expect(classify(record, today).status).toBe('malformed');
  });

  it('rounds a body through classify and plants it on the same world', () => {
    const first = session();
    const raw = good();
    raw.spider.position.x = 3;
    raw.spider.speed = 4;
    const parsed = classify(JSON.stringify(raw), today);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const world = first.world;
    applyBody(first, parsed.record);
    expect(first.world).toBe(world);
    expect(first.world.terrain.seed).toBe(raw.seed);
    expect(first.spider.root.position.x).toBe(3);
    expect(first.spider.speed).toBe(0);
    expect(first.spider.legs[0].lifted).toBe(false);

    // The blocked predicate bound by applyBody is the restored world's walls.
    first.spider.root.position.set(0, first.spider.root.position.y, 2);
    first.spider.yaw = Math.PI;
    first.spider.root.rotation.y = Math.PI;
    for (let i = 0; i < 20; i++) {
      first.spider.update(0.05, { throttle: 1, turn: 0, lift: 0, boost: 1 });
    }
    expect(first.spider.halt).toBe('solid');
  });

  it('keeps prop velocities and rejects broken ones', () => {
    const base = good();
    const apple = base.entities.find((entity) => entity.kind === 'apple')!;
    const withMotion = {
      ...base,
      entities: base.entities.map((entity) =>
        entity === apple ? { ...entity, vx: 1.5, vz: -0.5 } : entity,
      ),
    };
    const ok = classify(withMotion, today);
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') {
      expect(ok.record.entities.find((entity) => entity.id === apple.id)).toMatchObject({
        vx: 1.5,
        vz: -0.5,
      });
    }
    const badVx = {
      ...withMotion,
      entities: withMotion.entities.map((entity) =>
        entity.id === apple.id ? { ...entity, vx: 'fast' } : entity,
      ),
    };
    expect(classify(badVx, today).status).toBe('malformed');
    const badVz = {
      ...withMotion,
      entities: withMotion.entities.map((entity) =>
        entity.id === apple.id ? { ...entity, vz: Number.NaN } : entity,
      ),
    };
    expect(classify(badVz, today).status).toBe('malformed');
  });

  it('keeps a rolled orientation and rejects a partial one', () => {
    const base = good();
    const apple = base.entities.find((entity) => entity.kind === 'apple')!;
    const spun = {
      ...base,
      entities: base.entities.map((entity) =>
        entity === apple ? { ...entity, qx: 0, qy: 0, qz: 0.2, qw: 0.98 } : entity,
      ),
    };
    const ok = classify(spun, today);
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') {
      expect(ok.record.entities.find((entity) => entity.id === apple.id)).toMatchObject({
        qx: 0,
        qy: 0,
        qz: 0.2,
        qw: 0.98,
      });
    }
    const partial = {
      ...spun,
      entities: spun.entities.map((entity) =>
        entity.id === apple.id ? { ...entity, qw: undefined } : entity,
      ),
    };
    expect(classify(partial, today).status).toBe('malformed');
    const broken = {
      ...spun,
      entities: spun.entities.map((entity) =>
        entity.id === apple.id ? { ...entity, qy: 'nope' } : entity,
      ),
    };
    expect(classify(broken, today).status).toBe('malformed');
  });

  it('cuts a long sentence down to the stored limit', () => {
    const body = captureBody(session(), { text: '虫'.repeat(5000), tool: 'n'.repeat(40) });
    expect(body.pending?.text).toHaveLength(4000);
    expect(body.pending?.tool).toHaveLength(32);
    expect(captureBody(session(), { text: '', tool: null }).pending).toBeNull();
  });

  it('falls back to the default apple timer and sprout count', () => {
    const bare = session();
    bare.world.appleIn = undefined;
    bare.world.sprouts = undefined;
    const body = captureBody(bare, null);
    expect(body.appleIn).toBe(APPLE_EVERY);
    expect(body.sprouts).toBe(0);
  });

  it('picks the newer sequence, then the later stamp', () => {
    const older = good();
    const newerSeq = { ...good(), seq: 3 };
    const later = { ...good(), savedAt: older.savedAt + 5 };
    expect(chooseRecord(older, newerSeq, today)?.seq).toBe(3);
    expect(chooseRecord(later, older, today)?.savedAt).toBe(later.savedAt);
    expect(chooseRecord(null, null, today)).toBeNull();
    expect(chooseRecord('nope', older, today)?.seq).toBe(2);
    expect(newer(later, older)).toBe(later);
    expect(newer(older, later)).toBe(later);
  });

  it('keeps the current world regardless of its age', () => {
    const stored = { ...good(), day: '2020-01-01' };

    expect(classify(stored, today)).toEqual({ status: 'ok', record: stored });
    expect(chooseRecord(null, stored, today)).toEqual(stored);
    expect(classify({ ...stored, day: '2024-02-29' }, today).status).toBe('ok');
    expect(classify({ ...stored, day: '2026-02-29' }, today).status).toBe('malformed');
    expect(classify({ ...stored, day: '2026-02-31' }, today).status).toBe('malformed');
  });

  it('sorts empty, unknown, and broken records', () => {
    expect(classify(null, today).status).toBe('empty');
    expect(classify('', today).status).toBe('empty');
    expect(classify('   ', today).status).toBe('malformed');
    expect(classify('x'.repeat(64_001), today).status).toBe('malformed');
    expect(classify('{', today).status).toBe('malformed');
    expect(classify([], today).status).toBe('malformed');
    expect(classify(1, today).status).toBe('malformed');
    expect(classify({ ...good(), format: 4 }, today).status).toBe('format');
    expect(classify({ format: 4 }, today).status).toBe('format');
    expect(classify({ ...good(), format: undefined }, today).status).toBe('malformed');
    expect(classify({ ...good(), format: null }, today).status).toBe('malformed');
    expect(classify({ ...good(), format: '3' }, today).status).toBe('malformed');
    expect(classify({ ...good(), format: 0 }, today).status).toBe('malformed');
    expect(classify({ ...good(), format: -1 }, today).status).toBe('malformed');
    expect(classify({ ...good(), format: 1.5 }, today).status).toBe('malformed');
    expect(classify({ ...good(), format: Number.POSITIVE_INFINITY }, today).status).toBe(
      'malformed',
    );
    expect(classify({ ...good(), format: Number.MAX_SAFE_INTEGER + 1 }, today).status).toBe(
      'malformed',
    );

    const bad = (patch: Record<string, unknown>) => classify({ ...good(), ...patch }, today).status;
    expect(bad({ day: '2026-13-01' })).toBe('malformed');
    expect(bad({ day: '2026-00-10' })).toBe('malformed');
    expect(bad({ day: 'nope' })).toBe('malformed');
    expect(bad({ savedAt: Number.NaN })).toBe('malformed');
    expect(bad({ seq: 0 })).toBe('malformed');
    expect(bad({ seq: 1.5 })).toBe('malformed');
    expect(bad({ leaseUntil: Number.POSITIVE_INFINITY })).toBe('malformed');
    expect(bad({ owner: '' })).toBe('malformed');
    expect(bad({ owner: 4 })).toBe('malformed');
    expect(bad({ id: 'other' })).toBe('malformed');
    expect(bad({ seed: Number.NaN })).toBe('malformed');
    expect(bad({ appleIn: 25 })).toBe('malformed');
    expect(bad({ appleIn: -1 })).toBe('malformed');
    expect(bad({ sprouts: 1.2 })).toBe('malformed');
    expect(bad({ sprouts: -1 })).toBe('malformed');
    expect(bad({ sprouts: 1_000_001 })).toBe('malformed');
    expect(bad({ entities: 'no' })).toBe('malformed');
    expect(bad({ carrying: 'no' })).toBe('malformed');
    expect(bad({ pending: undefined })).toBe('ok');
    expect(bad({ pending: 4 })).toBe('malformed');
    expect(bad({ pending: { text: '', tool: null } })).toBe('ok');
    expect(bad({ pending: { text: 'a', tool: 1 } })).toBe('malformed');
    expect(bad({ pending: { text: 'a'.repeat(4001), tool: null } })).toBe('malformed');
    expect(bad({ pending: { text: 'a', tool: 'n'.repeat(33) } })).toBe('malformed');
    expect(bad({ pending: null })).toBe('ok');
  });

  it('rejects a world that is not one nest with unique props', () => {
    const base = good();
    const home = base.entities[0];
    const apple = base.entities.find((entity) => entity.kind === 'apple');
    expect(apple).toBeTruthy();
    const status = (entities: typeof base.entities, carrying = base.carrying) =>
      classify({ ...base, entities, carrying }, today).status;
    expect(status(base.entities.filter((entity) => entity.id !== 'home'))).toBe('malformed');
    expect(status([...base.entities, { ...home }])).toBe('malformed');
    expect(status(base.entities, [{ ...apple!, id: apple!.id }])).toBe('malformed');
    expect(status([], [])).toBe('malformed');
    const crowd = [
      home,
      ...Array.from({ length: 70 }, (_, index) => ({ ...apple!, id: `apple-${index}` })),
    ];
    expect(status(crowd)).toBe('malformed');
    expect(
      status(base.entities, [
        apple!,
        { ...apple!, id: 'apple-b' },
        { ...apple!, id: 'apple-c' },
        { ...apple!, id: 'apple-d' },
      ]),
    ).toBe('malformed');
    expect(
      status(
        base.entities,
        Array.from({ length: 8 }, (_, index) => ({ ...apple!, id: `carry-${index}` })),
      ),
    ).toBe('malformed');
    expect(status([{ ...home, kind: 'nope' }])).toBe('malformed');
    expect(status([{ ...home, id: 'bad id' }])).toBe('malformed');
    expect(status([{ ...home, x: Number.NaN }])).toBe('malformed');
    expect(status([{ ...home, stage: 9 }])).toBe('malformed');
    expect(status([{ ...home, footprint: { kind: 'circle', r: 0 } }])).toBe('malformed');
    expect(status([{ ...home, footprint: { kind: 'circle', r: 2 } }])).toBe('ok');
    expect(status([{ ...home, footprint: { kind: 'box', hx: 1, hz: 2 } }])).toBe('ok');
    expect(status([{ ...home, footprint: { kind: 'box', hx: 0, hz: 2 } }])).toBe('malformed');
    expect(status([{ ...home, footprint: { kind: 'triangle' } }])).toBe('malformed');
    expect(status([{ ...home, footprint: 'disk' }])).toBe('malformed');
    expect(status([home, null as unknown as typeof home])).toBe('malformed');
    const spider = structuredClone(base.spider);
    expect(classify({ ...base, spider: null }, today).status).toBe('malformed');
    expect(classify({ ...base, spider: { ...spider, yaw: Number.NaN } }, today).status).toBe(
      'malformed',
    );
    expect(classify({ ...base, spider: { ...spider, time: 'late' } }, today).status).toBe(
      'malformed',
    );
    expect(
      classify({ ...base, spider: { ...spider, feet: spider.feet.slice(0, 7) } }, today).status,
    ).toBe('malformed');
    expect(
      classify(
        { ...base, spider: { ...spider, feet: spider.feet.map((foot) => ({ ...foot, y: 5000 })) } },
        today,
      ).status,
    ).toBe('malformed');
    expect(classify({ ...base, spider: { ...spider, position: null } }, today).status).toBe(
      'malformed',
    );
  });

  it('names today from the local clock', () => {
    expect(localDate(new Date(2026, 10, 2, 23))).toBe('2026-11-02');
  });
});
