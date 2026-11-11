import { describe, expect, it } from 'vitest';
import { KINDS } from '@/src/shared/kinds';
import { localDate } from '@/src/shared/dates';
import { MARK_LIMIT, MARK_NAME_MAX, MARK_NOTE_MAX } from '@/src/shared/config';
import { SimSession } from '@/src/shared/sim/session';
import { Terrain } from '@/src/shared/terrain';
import {
  applyBody,
  captureBody,
  chooseRecord,
  classify,
  FORMAT,
  MAX_ENTITIES,
  newer,
  type WorldRecord,
} from '@/src/shared/sim/snapshot';

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
    format: FORMAT,
    savedAt: 1_700_000_000_000,
    day: today,
    owner: 'tab',
    seq: 2,
    leaseUntil: 1_700_000_006_000,
  };
}

describe('snapshot', () => {
  it('rounds named places through a body and restores them', () => {
    const record = good();
    record.marks = [{ name: '水边', x: 2, z: -3, note: '喝水' }];
    const parsed = classify(JSON.stringify(record), today);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.record.marks).toEqual(record.marks);

    const target = session();
    applyBody(target, parsed.record);
    expect(target.world.marks).toEqual(record.marks);

    const frozen = captureBody(target, null);
    target.world.marks[0].x = 9;
    expect(frozen.marks[0].x).toBe(2);
  });

  it('requires marks and rejects malformed locations', () => {
    const valid = { name: '水边', x: 2, z: -3 };
    const status = (marks: unknown): string => classify({ ...good(), marks }, today).status;
    expect(status(undefined)).toBe('malformed');
    expect(status([valid])).toBe('ok');
    expect(status([{ ...valid, note: '喝水' }])).toBe('ok');
    expect(status('no')).toBe('malformed');
    expect(status([null])).toBe('malformed');
    expect(status(['no'])).toBe('malformed');
    expect(status([valid, valid])).toBe('malformed');
    expect(status([{ ...valid, name: '' }])).toBe('malformed');
    expect(status([{ ...valid, name: ' 水边' }])).toBe('malformed');
    expect(status([{ ...valid, name: 'x'.repeat(MARK_NAME_MAX + 1) }])).toBe('malformed');
    expect(status([{ ...valid, x: Number.NaN }])).toBe('malformed');
    expect(status([{ ...valid, z: '2' }])).toBe('malformed');
    expect(status([{ ...valid, note: 4 }])).toBe('malformed');
    expect(status([{ ...valid, note: '' }])).toBe('malformed');
    expect(status([{ ...valid, note: ' 喝水' }])).toBe('malformed');
    expect(status([{ ...valid, note: 'x'.repeat(MARK_NOTE_MAX + 1) }])).toBe('malformed');
    expect(
      status(
        Array.from({ length: MARK_LIMIT + 1 }, (_, index) => ({
          ...valid,
          name: `地点-${index}`,
        })),
      ),
    ).toBe('malformed');
  });

  it('keeps prop velocities and rejects broken ones', () => {
    const base = good();
    const apple = base.entities.find((entity) => entity.kind === 'apple')!;
    const withMotion = {
      ...base,
      entities: base.entities.map((entity) =>
        entity === apple ? { ...entity, vx: 1.5, vy: -0.25, vz: -0.5 } : entity,
      ),
    };
    const ok = classify(withMotion, today);
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') {
      expect(ok.record.entities.find((entity) => entity.id === apple.id)).toMatchObject({
        vx: 1.5,
        vy: -0.25,
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
    const badVy = {
      ...withMotion,
      entities: withMotion.entities.map((entity) =>
        entity.id === apple.id ? { ...entity, vy: Infinity } : entity,
      ),
    };
    expect(classify(badVy, today).status).toBe('malformed');
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
    expect(classify({ ...good(), format: 5 }, today).status).toBe('format');
    expect(classify({ format: 5 }, today).status).toBe('format');
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
    expect(bad({ entities: 'no' })).toBe('malformed');
    expect(bad({ pending: undefined })).toBe('ok');
    expect(bad({ pending: 4 })).toBe('malformed');
    expect(bad({ pending: { text: '', tool: null } })).toBe('ok');
    expect(bad({ pending: { text: 'a', tool: 1 } })).toBe('malformed');
    expect(bad({ pending: { text: 'a'.repeat(4001), tool: null } })).toBe('malformed');
    expect(bad({ pending: { text: 'a', tool: 'n'.repeat(33) } })).toBe('malformed');
    expect(bad({ pending: null })).toBe('ok');
  });

  it('rejects malformed entity sequences, population clocks and lifetimes', () => {
    const record = good();
    const status = (patch: Record<string, unknown>) =>
      classify({ ...record, ...patch }, today).status;
    const clock = { remaining: 6, attempts: 3 };
    for (const entitySerials of [
      null,
      [],
      'bad',
      { absent: 1 },
      { apple: '1' },
      { apple: 1.5 },
      { apple: 0 },
    ]) {
      expect(status({ entitySerials })).toBe('malformed');
    }
    for (const populations of [
      null,
      [],
      'bad',
      { absent: clock },
      { berries: null },
      { berries: 1 },
    ]) {
      expect(status({ populations })).toBe('malformed');
    }
    for (const remaining of [Number.NaN, -1, 13]) {
      expect(status({ populations: { berries: { ...clock, remaining } } })).toBe('malformed');
    }
    for (const attempts of [Number.NaN, 1.5, -1, 1_000_001]) {
      expect(status({ populations: { berries: { ...clock, attempts } } })).toBe('malformed');
    }
    const berry = record.entities.find((item) => item.kind === 'berry')!;
    const withBerry = (patch: Record<string, unknown>) =>
      status({
        entities: record.entities.map((item) =>
          item.id === berry.id ? { ...item, ...patch } : item,
        ),
      });
    expect(withBerry({ kind: null })).toBe('malformed');
    expect(withBerry({ expiresAt: Number.NaN })).toBe('malformed');
    expect(withBerry({ expiresAt: -1 })).toBe('malformed');
    const [home, ...others] = record.entities;
    expect(status({ entities: [{ ...home, expiresAt: 1 }, ...others] })).toBe('malformed');
  });

  it('names today from the local clock', () => {
    expect(localDate(new Date(2026, 10, 2, 23))).toBe('2026-11-02');
  });
});

describe('entity snapshots', () => {
  it('round-trips one authoritative actor and moving items without repairing the scene', () => {
    const source = session();
    const actor = source.actor.entity;
    Object.assign(actor, { x: 3, y: 4, z: -2, vx: 1, vy: -2, vz: 3 });
    Object.assign(actor.control!, {
      yaw: 0.3,
      yawRate: 0.4,
      speed: 1,
      fall: 2,
      stuckFor: 0.1,
      halt: 'solid',
      lamp: true,
    });
    source.spider.headYaw = 0.2;
    source.world.entities.delete('home');
    const fruit = [...source.world.entities.values()].find((entity) => entity.kind === 'apple')!;
    Object.assign(fruit, { y: 5, vx: 2, vy: -1, vz: 3, qx: 0, qy: 0, qz: 0.6, qw: 0.8 });
    source.world.tethers.set(fruit.id, {
      sourceId: source.actor.entity.id,
      targetId: fruit.id,
      length: 3.7,
    });
    const saved = captureBody(source, null);
    expect(saved).not.toHaveProperty('spider');
    expect(saved).not.toHaveProperty('carrying');
    expect(saved).not.toHaveProperty('appleIn');
    const parsed = classify({ ...good(), ...saved });
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') throw new Error('Expected a valid new snapshot');
    const target = session();
    applyBody(target, parsed.record);
    expect(target.world.entities).toEqual(source.world.entities);
    expect(target.world.entities.get(saved.controlledId)).toBe(target.actor.entity);
    expect(target.world.tethers.get(fruit.id)).toEqual({
      sourceId: actor.id,
      targetId: fruit.id,
      length: 3.7,
    });
    expect(target.actor.state).toEqual(actor.control);
    expect(target.spider.headYaw).toBe(0.2);
    expect(target.spider.root.position.toArray()).toEqual([3, 4, -2]);
    expect(target.world.entities.has('home')).toBe(false);
    actor.x = 100;
    expect(target.actor.position.x).toBe(3);
    expect(saved.entities.find((item) => item.id === saved.controlledId)!.x).toBe(3);
  });

  it('rejects incomplete candidates before changing the live world or cancelling its action', async () => {
    const target = session();
    const world = target.world.entities;
    const action = target.walk(0);
    const broken = captureBody(target, null);
    broken.controlledId = 'missing';
    expect(() => applyBody(target, broken)).toThrow('Invalid world snapshot');
    expect(target.world.entities).toBe(world);
    target.frame(1 / 60);
    await expect(action).resolves.toMatchObject({ ok: true });
  });

  it.each([1, 2, 3, 5])('rejects format %s without a migration', (format) => {
    expect(classify({ ...good(), format }).status).toBe('format');
  });

  it('validates identity, registered capabilities and all optional physical data', () => {
    const base = good();
    const actor = base.entities.find((item) => item.id === base.controlledId)!;
    const item = base.entities.find((entity) => entity.kind === 'apple')!;
    const status = (patch: Record<string, unknown>) => classify({ ...base, ...patch }).status;
    expect(status({ controlledId: null })).toBe('malformed');
    expect(status({ controlledId: item.id })).toBe('malformed');
    expect(status({ entities: [] })).toBe('malformed');
    expect(status({ entities: [...base.entities, actor] })).toBe('malformed');
    expect(status({ entities: Array.from({ length: MAX_ENTITIES + 1 }, () => item) })).toBe(
      'malformed',
    );
    const withItem = (patch: Record<string, unknown>) =>
      status({
        entities: base.entities.map((entity) =>
          entity.id === item.id ? { ...item, ...patch } : entity,
        ),
      });
    for (const patch of [
      { kind: 'unknown' },
      { id: 'bad id' },
      { x: NaN },
      { y: 2000 },
      { z: 1_000_001 },
      { stage: -1 },
      { stage: 9 },
      { control: {} },
      { footprint: 'disk' },
      { footprint: { kind: 'triangle' } },
      { footprint: { kind: 'circle', r: 0 } },
      { footprint: { kind: 'box', hx: 1, hz: 0 } },
    ]) {
      expect(withItem(patch)).toBe('malformed');
    }
    expect(status({ entities: [null, actor] })).toBe('malformed');
    expect(withItem({ footprint: { kind: 'circle', r: 2 } })).toBe('ok');
    expect(withItem({ footprint: { kind: 'box', hx: 1, hz: 2 } })).toBe('ok');
    for (const control of [
      null,
      {},
      { ...actor.control, time: -1 },
      { ...actor.control, speed: Infinity },
      { ...actor.control, fall: -1 },
      { ...actor.control, stuckFor: -1 },
      { ...actor.control, height: -5 },
      { ...actor.control, height: 5 },
      { ...actor.control, lamp: 1 },
      { ...actor.control, halt: 'invalid' },
    ]) {
      expect(
        status({
          entities: base.entities.map((entity) =>
            entity.id === actor.id ? { ...actor, control } : entity,
          ),
        }),
      ).toBe('malformed');
    }
  });

  it('validates every tether endpoint and restores expired targets before publication', () => {
    const base = good();
    const fruit = base.entities.find((item) => item.kind === 'apple')!;
    const berry = base.entities.find((item) => item.kind === 'berry')!;
    const relation = { sourceId: base.controlledId, targetId: fruit.id, length: 2 };
    for (const tethers of [
      null,
      [null],
      [{ targetId: 4, length: 2 }],
      [{ ...relation, targetId: base.controlledId }],
      [{ ...relation, targetId: 'missing' }],
      [{ ...relation, targetId: berry.id }],
      [relation, relation],
      [{ ...relation, length: NaN }],
      [{ ...relation, length: 0 }],
      [{ ...relation, length: 3_000_001 }],
      Array.from({ length: 8 }, () => relation),
    ]) {
      expect(classify({ ...base, tethers }).status).toBe('malformed');
    }
    expect(classify({ ...base, tethers: [relation] }).status).toBe('ok');
    berry.expiresAt = 0;
    const target = session();
    applyBody(target, base);
    expect(target.world.entities.has(berry.id)).toBe(false);
  });

  it('validates the saved visual pose separately from the physical actor', () => {
    const base = good();
    for (const pose of [
      null,
      { ...base.pose, headYaw: NaN },
      { ...base.pose, chassisPitch: NaN },
      { ...base.pose, chassisRoll: NaN },
      { ...base.pose, feet: [] },
      { ...base.pose, feet: base.pose.feet.map(() => null) },
      { ...base.pose, feet: base.pose.feet.map((foot) => ({ ...foot, y: 5000 })) },
    ]) {
      expect(classify({ ...base, pose }).status).toBe('malformed');
    }
  });
});

it('rejects a candidate whose controlled entity expires before publication', () => {
  const target = session();
  const before = target.world.entities;
  const body = captureBody(target, null);
  body.entities.find((item) => item.id === body.controlledId)!.expiresAt = 0;
  KINDS.spider.lifetime = 1;
  try {
    expect(() => applyBody(target, body)).toThrow('Controlled entity expired');
    expect(target.world.entities).toBe(before);
  } finally {
    delete KINDS.spider.lifetime;
  }
});
