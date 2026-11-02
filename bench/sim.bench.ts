import { describe, test } from 'vitest';
import { buildProp } from '../src/client/props.js';
import { localDate } from '../src/shared/dates.js';
import { applyBody, captureBody, classify, type WorldRecord } from '../src/shared/sim/snapshot.js';
import { SimSession } from '../src/shared/sim/session.js';

const idle = new SimSession(7);
const body = captureBody(idle, { text: '去巢边', tool: 'walk' });
const record: WorldRecord = {
  ...body,
  id: 'current',
  format: 1,
  savedAt: Date.now(),
  day: localDate(new Date()),
  owner: 'bench',
  seq: 1,
  leaseUntil: Date.now() + 60_000,
};
const wire = JSON.stringify(record);

describe('simulation', () => {
  test('create a seeded island', async ({ bench }) => {
    await bench('create a seeded island', () => {
      new SimSession(1234);
    }).run();
  });

  test('120 idle frames', async ({ bench }) => {
    await bench('120 idle frames', () => {
      const session = new SimSession(1234);
      for (let i = 0; i < 120; i++) session.frame(1 / 60);
    }).run();
  });

  test('capture a body', async ({ bench }) => {
    await bench('capture a body', () => {
      captureBody(idle, { text: '去巢边', tool: 'walk' });
    }).run();
  });

  test('apply a body', async ({ bench }) => {
    await bench('apply a body', () => {
      applyBody(new SimSession(1), body);
    }).run();
  });

  test('sense the body', async ({ bench }) => {
    await bench('sense the body', () => {
      idle.sense();
    }).run();
  });

  test('observe the island', async ({ bench }) => {
    await bench('observe the island', () => {
      idle.observe();
    }).run();
  });

  test('build a grass patch', async ({ bench }) => {
    await bench('build a grass patch', () => {
      buildProp('grass', 0, { kind: 'circle', r: 3.2 });
    }).run();
  });
});

describe('snapshot wire', () => {
  test('serialize', async ({ bench }) => {
    await bench('serialize', () => {
      JSON.stringify(record);
    }).run();
  });

  test('classify a serialized record', async ({ bench }) => {
    await bench('classify a serialized record', () => {
      classify(wire, record.day);
    }).run();
  });
});
