import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelUsage } from 'ai';
import { openSpiderDb, resetSpiderDb, type UsageDay } from '../../src/client/journal/db.js';
import {
  byteSize,
  readUsage,
  recordUsage,
  recordUsageCall,
  recordUsageCalls,
  usageCallFromStep,
  usageCallFromUsage,
} from '../../src/client/journal/usage.js';
import { formatTokens } from '../../src/client/journal/tokens.js';

function usage(
  input: number | undefined,
  output: number | undefined,
  total: number | undefined,
  cache?: number,
  reasoning?: number,
): LanguageModelUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: cache,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: reasoning },
  };
}

beforeEach(async () => {
  await resetSpiderDb();
});

describe('recordUsage', () => {
  const day = new Date(2026, 10, 2, 15);

  it('ignores a call that reported no tokens', async () => {
    await recordUsage(null, day);
    await recordUsage(undefined, day);
    await recordUsage(usage(undefined, undefined, undefined), day);
    expect((await readUsage('2026-11-02')).days).toEqual([]);
  });

  it('adds a call onto the local day and sums later calls', async () => {
    await recordUsage(usage(10, 2, 12, 4, 1), day);
    await recordUsage(usage(1, 1, 2), day);
    await recordUsage(usage(3, 0, 3), new Date(2026, 10, 1, 9));
    const snapshot = await readUsage('2026-11-02');
    expect(snapshot.today).toMatchObject({
      date: '2026-11-02',
      input: 11,
      output: 3,
      total: 14,
      calls: 2,
      cacheRead: 4,
      reasoning: 1,
    });
    expect(snapshot.sum).toMatchObject({ input: 14, output: 3, total: 17, calls: 3, cacheRead: 4 });
    expect(snapshot.days.map((row) => row.date)).toEqual(['2026-11-02', '2026-11-01']);
  });

  it('counts an explicit zero and fills missing detail', async () => {
    await recordUsage(
      { inputTokens: 0, outputTokens: undefined, totalTokens: undefined } as LanguageModelUsage,
      day,
    );
    expect((await readUsage('2026-11-02')).today).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
      calls: 1,
      cacheRead: 0,
      reasoning: 0,
    });
  });

  it('drops non-finite and negative numbers', async () => {
    const db = await openSpiderDb();
    await db.put('usage', {
      date: '2026-11-02',
      input: -5,
      output: Number.NaN,
      total: 'no',
      calls: 1.9,
      cacheRead: undefined,
      reasoning: Number.POSITIVE_INFINITY,
    } as unknown as UsageDay);
    const snapshot = await readUsage('2026-11-03');
    expect(snapshot.days[0]).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
      calls: 1,
      cacheRead: 0,
      reasoning: 0,
    });
    expect(snapshot.today).toMatchObject({ date: '2026-11-03', calls: 0 });
    expect(snapshot.sum.calls).toBe(1);
  });

  it('keeps going when the ledger cannot be written', async () => {
    const db = await openSpiderDb();
    const transaction = vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('usage down');
    });
    await expect(recordUsage(usage(1, 1, 2), day)).resolves.toBeUndefined();
    await expect(
      recordUsageCall({
        id: 'x',
        ts: day.getTime(),
        date: '2026-11-02',
        kind: 'agent',
        sessionId: '2026-11-02',
        turnId: 't',
        step: 0,
        provider: '',
        modelId: '',
        total: 2,
        input: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        output: { total: 1, text: 1, reasoning: 0 },
        tools: [],
        timing: { responseMs: 0, stepMs: 0 },
        finishReason: '',
      }),
    ).resolves.toBeUndefined();
    transaction.mockRestore();
    expect((await readUsage('2026-11-02')).days).toEqual([]);
  });

  it('ignores an empty batch', async () => {
    await recordUsageCalls([]);
    expect((await readUsage('2026-11-02')).days).toEqual([]);
  });

  it('makes the token parts add up to the reported total', async () => {
    await recordUsage(usage(10, 2, 12, 4, 0), day);
    const snapshot = await readUsage('2026-11-02');
    const { input, output, cacheRead, cacheWrite, text, reasoning } = snapshot.kpis;
    const parts =
      Math.max(0, input - cacheRead - cacheWrite) + cacheRead + cacheWrite + text + reasoning;
    expect(parts).toBe(input + output);
    expect(snapshot.requests[0]?.input.noCache).toBe(6);
    expect(snapshot.requests[0]?.output.text).toBe(2);
  });
});

describe('recordUsageCall', () => {
  const day = new Date(2026, 10, 2, 15);

  it('counts three model steps as three requests', async () => {
    const turn = 'turn-1';
    for (const step of [0, 1, 2]) {
      await recordUsageCall(
        usageCallFromStep(
          {
            callId: 'call-1',
            stepNumber: step,
            model: { provider: 'openai-compatible', modelId: 'deepseek-chat' },
            usage: usage(10, 1, 11, 4, 0),
            finishReason: step === 2 ? 'stop' : 'tool-calls',
            toolCalls:
              step === 2 ? [] : [{ toolCallId: `t${step}`, toolName: 'observe', input: { n: 1 } }],
            toolResults: step === 2 ? [] : [{ toolCallId: `t${step}`, output: { ok: true } }],
            performance: {
              timeToFirstOutputMs: 80,
              responseTimeMs: 200,
              stepTimeMs: 240,
              toolExecutionMs: { [`t${step}`]: 18 },
            },
          },
          {
            kind: 'agent',
            sessionId: '2026-11-02',
            turnId: turn,
            date: '2026-11-02',
            ts: day.getTime() + step,
          },
        ),
      );
    }
    const snapshot = await readUsage('2026-11-02');
    expect(snapshot.today.calls).toBe(3);
    expect(snapshot.kpis.calls).toBe(3);
    expect(snapshot.kpis.toolCalls).toBe(2);
    expect(snapshot.models[0]).toMatchObject({ modelId: 'deepseek-chat', calls: 3 });
    expect(snapshot.tools[0]).toMatchObject({ name: 'observe', calls: 2, ok: 2 });
    expect(snapshot.requests).toHaveLength(3);
  });

  it('writes several steps in one batch', async () => {
    const base = {
      ts: day.getTime(),
      date: '2026-11-02',
      kind: 'agent' as const,
      sessionId: '2026-11-02',
      turnId: 'turn-batch',
      provider: 'openai-compatible',
      modelId: 'deepseek-chat',
      total: 2,
      input: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      output: { total: 1, text: 1, reasoning: 0 },
      tools: [],
      timing: { responseMs: 5, stepMs: 6 },
      finishReason: 'stop',
    };
    await recordUsageCalls([0, 1, 2].map((step) => ({ ...base, id: `batch-${step}`, step })));
    const snapshot = await readUsage('2026-11-02', '7');
    expect(snapshot.today.calls).toBe(3);
    expect(snapshot.requests).toHaveLength(3);
    expect(snapshot.kpis.calls).toBe(3);
  });

  it('caps the request list but keeps totals over the cap', async () => {
    const base = {
      ts: day.getTime(),
      date: '2026-11-02',
      kind: 'agent' as const,
      sessionId: '2026-11-02',
      turnId: 'turn-cap',
      provider: 'openai-compatible',
      modelId: 'deepseek-chat',
      total: 2,
      input: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      output: { total: 1, text: 1, reasoning: 0 },
      tools: [],
      timing: { responseMs: 5, stepMs: 6 },
      finishReason: 'stop',
    };
    await recordUsageCalls(
      Array.from({ length: 205 }, (_, index) => ({
        ...base,
        id: `cap-${index}`,
        step: index,
        ts: day.getTime() + index,
      })),
    );
    const snapshot = await readUsage('2026-11-02');
    expect(snapshot.requests).toHaveLength(200);
    expect(snapshot.requestTotal).toBe(205);
    expect(snapshot.kpis.calls).toBe(205);
    expect(snapshot.models[0]?.calls).toBe(205);
  });

  it('treats missing provider fields as zero and keeps a failed tool', async () => {
    await recordUsageCall(
      usageCallFromStep(
        {
          callId: 'call-2',
          stepNumber: 0,
          model: { provider: '', modelId: '' },
          usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
            inputTokenDetails: {
              noCacheTokens: undefined,
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
            },
            outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
          },
          finishReason: 'error',
          toolCalls: [{ toolCallId: 't-fail', toolName: 'pick_up', input: { id: 'a' } }],
          toolResults: [],
          performance: { responseTimeMs: Number.NaN, stepTimeMs: 12, toolExecutionMs: {} },
        },
        {
          kind: 'agent',
          sessionId: '2026-11-02',
          turnId: 't',
          date: '2026-11-02',
          ts: day.getTime(),
        },
      ),
    );
    const snapshot = await readUsage('2026-11-02', '7');
    expect(snapshot.today).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
      calls: 1,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    });
    expect(snapshot.kpis.cacheHitRate).toBe(0);
    expect(snapshot.tools[0]).toMatchObject({ name: 'pick_up', calls: 1, ok: 0 });
    expect(snapshot.chart).toHaveLength(7);
    expect(Number.isNaN(snapshot.kpis.toolOkRate)).toBe(false);
    expect(snapshot.requests[0]?.timing.responseMs).toBeUndefined();
    expect(snapshot.requests[0]?.timing.stepMs).toBe(12);
  });

  it('marks a diary summary separately from an agent turn', async () => {
    const call = usageCallFromUsage(usage(4, 1, 5), day, {
      kind: 'summary',
      sessionId: '2026-11-02',
      provider: 'openai-compatible',
      modelId: 'deepseek-reasoner',
    });
    expect(call?.kind).toBe('summary');
    await recordUsageCall(call!);
    const snapshot = await readUsage('2026-11-02', '30');
    expect(snapshot.range).toBe('30');
    expect(snapshot.chart).toHaveLength(30);
    expect(snapshot.requests[0]?.kind).toBe('summary');
    expect(snapshot.kpis.previousCalls).toBe(0);
  });

  it('filters the chart to the selected range', async () => {
    await recordUsage(usage(1, 1, 2), new Date(2026, 9, 1, 9));
    await recordUsage(usage(3, 1, 4), day);
    const week = await readUsage('2026-11-02', '7');
    expect(week.days.map((row) => row.date)).toEqual(['2026-11-02']);
    expect(week.kpis.calls).toBe(1);
    const all = await readUsage('2026-11-02', 'all');
    expect(all.days.map((row) => row.date)).toEqual(['2026-11-02', '2026-10-01']);
    expect(all.kpis.calls).toBe(2);
    expect(all.kpis.previousCalls).toBeNull();
  });
});

describe('usageCall helpers', () => {
  it('derives missing detail tokens from the totals', () => {
    const call = usageCallFromUsage(usage(10, 2, 12, 4, 1), new Date(2026, 10, 2, 15))!;
    expect(call.input).toMatchObject({ total: 10, noCache: 6, cacheRead: 4 });
    expect(call.output).toMatchObject({ total: 2, text: 1, reasoning: 1 });
    expect(call.timing).toEqual({});
    const written = usageCallFromUsage(
      {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: 0 },
      },
      new Date(2026, 10, 2, 15),
    )!;
    expect(written.input.noCache).toBe(5);
  });

  it('reads tools off the step when none are supplied', () => {
    const call = usageCallFromStep(
      {
        toolCalls: [{ toolName: 'wait', input: { ms: 1 } }],
        toolResults: [{ output: { ok: true } }],
      },
      {
        kind: 'agent',
        sessionId: '2026-11-02',
        turnId: 't',
        date: '2026-11-02',
        ts: 1,
      },
    );
    expect(call.tools[0]).toMatchObject({ name: 'wait', ok: true, id: '' });
    expect(
      usageCallFromStep(
        {
          toolCalls: [{ toolCallId: 'missing', toolName: 'drop' }],
          toolResults: [{ toolCallId: 'other', output: { ok: true } }],
        },
        { kind: 'agent', sessionId: 'd', turnId: 't', date: 'd', ts: 1 },
      ).tools[0],
    ).toMatchObject({ name: 'drop', ok: false });
    expect(
      usageCallFromStep(
        { toolCalls: [{}] },
        { kind: 'agent', sessionId: 'd', turnId: 't', date: 'd', ts: 1 },
      ).tools[0],
    ).toMatchObject({ name: '', ok: false });
    expect(
      usageCallFromStep({}, { kind: 'agent', sessionId: 'd', turnId: 't', date: 'd', ts: 1 }).tools,
    ).toEqual([]);
  });

  it('sorts models and tools with ties, and finds the earliest date', async () => {
    const base = {
      ts: 1,
      kind: 'agent' as const,
      sessionId: 's',
      turnId: 't',
      step: 0,
      provider: 'p',
      total: 10,
      input: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
      output: { total: 2, text: 2, reasoning: 0 },
      timing: { responseMs: 10, stepMs: 10 },
      finishReason: 'stop',
    };
    await recordUsageCall({
      ...base,
      id: 'a',
      date: '2026-11-02',
      modelId: 'model-a',
      tools: [{ id: '1', name: 'move_to', ok: true, durationMs: 1, inputBytes: 1, outputBytes: 1 }],
    });
    await recordUsageCall({
      ...base,
      id: 'z',
      date: '2026-10-01',
      modelId: 'model-b',
      tools: [
        { id: '2', name: 'observe', ok: true, durationMs: 1, inputBytes: 1, outputBytes: 1 },
        { id: '3', name: 'wait', ok: true, durationMs: 1, inputBytes: 1, outputBytes: 1 },
      ],
    });
    await recordUsageCall({
      ...base,
      id: 'm',
      date: '2026-11-02',
      modelId: 'model-a',
      total: 4,
      tools: [{ id: '4', name: 'observe', ok: true, durationMs: 1, inputBytes: 1, outputBytes: 1 }],
    });
    const snapshot = await readUsage('2026-11-02', 'all');
    expect(snapshot.days.map((day) => day.date).at(-1)).toBe('2026-10-01');
    expect(snapshot.models[0]?.modelId).toBe('model-a');
    expect(snapshot.tools[0]?.name).toBe('observe');
  });

  it('picks the earliest call date when stored days are empty', async () => {
    const db = await openSpiderDb();
    const stub = {
      ts: 1,
      kind: 'agent' as const,
      sessionId: 's',
      turnId: 't',
      step: 0,
      provider: '',
      modelId: 'same',
      total: 6,
      input: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
      output: { total: 2, text: 2, reasoning: 0 },
      tools: [] as const,
      timing: { responseMs: 1, stepMs: 1 },
      finishReason: '',
    };
    await db.put('usageCalls', { ...stub, id: 'a', date: '2026-11-02', modelId: 'left', total: 3 });
    await db.put('usageCalls', {
      ...stub,
      id: 'z',
      date: '2026-10-01',
      modelId: 'right',
      total: 6,
    });
    await db.put('usageCalls', { ...stub, id: 'b', date: '2026-11-02', modelId: 'left', total: 3 });
    const snapshot = await readUsage('2026-11-02', 'all');
    expect(snapshot.chart[0]?.date).toBe('2026-10-01');
    expect(snapshot.models.find((row) => row.modelId === 'left')?.calls).toBe(2);
  });

  it('builds a step without a call id and measures bytes', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const call = usageCallFromStep(
      {
        stepNumber: 2,
        toolCalls: [{ toolName: 'wait', input: { ms: 1 } }],
        toolResults: [{ output: { ok: true } }],
      },
      {
        kind: 'agent',
        sessionId: '2026-11-02',
        turnId: 't',
        date: '2026-11-02',
        ts: 1,
        tools: [
          {
            id: 'x',
            name: 'wait',
            ok: true,
            durationMs: 20,
            inputBytes: 4,
            outputBytes: 8,
          },
        ],
      },
    );
    expect(call.id.startsWith('step:')).toBe(true);
    expect(call.step).toBe(2);
    expect(call.tools[0]?.name).toBe('wait');
    expect(byteSize(null)).toBe(0);
    expect(byteSize('ab')).toBe(2);
    expect(byteSize({ n: 1 })).toBeGreaterThan(0);
    expect(byteSize(circular)).toBe(0);
    expect(usageCallFromUsage(null, new Date())).toBeNull();
  });

  it('uses stored days for last-period comparison when no call rows exist', async () => {
    const db = await openSpiderDb();
    await db.put('usage', {
      date: '2026-10-25',
      input: 1,
      output: 1,
      total: 2,
      calls: 5,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      textTokens: 1,
      toolCalls: 0,
    });
    await db.put('usage', {
      date: '2026-09-20',
      input: 1,
      output: 0,
      total: 1,
      calls: 4,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      textTokens: 0,
      toolCalls: 0,
    });
    await db.put('usage', {
      date: '2026-11-02',
      input: 2,
      output: 0,
      total: 2,
      calls: 1,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      textTokens: 0,
      toolCalls: 0,
    });
    const week = await readUsage('2026-11-02', '7');
    expect(week.kpis.calls).toBe(1);
    expect(week.kpis.previousCalls).toBe(5);
    const month = await readUsage('2026-11-02', '30');
    expect(month.kpis.previousCalls).toBe(4);
  });

  it('makes ids without randomUUID', () => {
    vi.stubGlobal('crypto', {});
    const call = usageCallFromUsage(usage(1, 1, 2), new Date(2026, 10, 2, 15));
    expect(call?.id.startsWith('usage:')).toBe(true);
    expect(
      usageCallFromUsage(usage(1, 1, 2), new Date(2026, 10, 2, 15), { turnId: 'fixed' })?.turnId,
    ).toBe('fixed');
    expect(byteSize(() => 1)).toBe(0);
  });

  it('fills missing call fields so the snapshot never sees NaN', async () => {
    const db = await openSpiderDb();
    await db.put('usageCalls', {
      id: '',
      ts: Number.NaN,
      kind: 'other',
      tools: 'nope',
    } as never);
    await db.put('usageCalls', {
      id: 'kept',
      ts: 2,
      date: '2026-11-02',
      sessionId: undefined,
      tools: [
        { ok: false, durationMs: -2 },
        { name: 'x', ok: false },
      ],
    } as never);
    const snapshot = await readUsage('2026-11-02');
    expect(snapshot.requests.some((row) => row.id === 'kept')).toBe(true);
    expect(snapshot.requests.some((row) => row.id.length > 0)).toBe(true);
    expect(snapshot.tools.some((row) => row.name === 'x')).toBe(true);
    expect(snapshot.tools.some((row) => row.name === '未知工具')).toBe(true);
    expect(Number.isNaN(snapshot.kpis.toolOkRate)).toBe(false);
  });
});

describe('formatTokens', () => {
  it('keeps small counts and compacts thousands, millions, and billions', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(123_456)).toBe('123.5k');
    expect(formatTokens(999_500)).toBe('999.5k');
    expect(formatTokens(1_500_000)).toBe('1.5m');
    expect(formatTokens(1_200_000_000)).toBe('1.2b');
    expect(formatTokens(999_950)).toBe('1m');
    expect(formatTokens(2_000_000_000_000)).toBe('2000b');
  });
});

function openLegacy(stores: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('spider', 1);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      for (const name of stores) database.createObjectStore(name, { keyPath: 'date' });
    });
    request.addEventListener('success', () => {
      request.result.close();
      resolve();
    });
    request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
  });
}

describe('openSpiderDb', () => {
  it('adds the cloud store to a database created before it', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('spider', 6);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        database.createObjectStore('sessions', { keyPath: 'date' });
        database.createObjectStore('memories', { keyPath: 'date' });
        database.createObjectStore('usage', { keyPath: 'date' });
        database.createObjectStore('usageCalls', { keyPath: 'id' });
        database.createObjectStore('snapshots', { keyPath: 'id' });
        database.createObjectStore('preferences', { keyPath: 'id' });
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
    });
    const db = await openSpiderDb();
    expect(db.objectStoreNames.contains('cloud')).toBe(true);
    expect(db.objectStoreNames.contains('preferences')).toBe(true);
  });

  it('keeps a cloud store that an older database already had', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('spider', 6);
      request.addEventListener('upgradeneeded', () => {
        request.result.createObjectStore('cloud', { keyPath: 'id' });
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
    });
    const db = await openSpiderDb();
    expect(db.objectStoreNames.contains('cloud')).toBe(true);
    expect(db.objectStoreNames.contains('memories')).toBe(true);
  });

  it('adds the usage store to a database created before it', async () => {
    await openLegacy(['sessions', 'memories']);
    const db = await openSpiderDb();
    expect(db.objectStoreNames.contains('usage')).toBe(true);
    expect(db.objectStoreNames.contains('sessions')).toBe(true);
    expect(db.objectStoreNames.contains('preferences')).toBe(true);
  });

  it('keeps existing preferences when upgrading a database', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('spider', 5);
      request.addEventListener('upgradeneeded', () => {
        const preferences = request.result.createObjectStore('preferences', { keyPath: 'id' });
        preferences.put({ id: 'pilot', updatedAt: 1, value: { model: 'kept' } });
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
    });
    const db = await openSpiderDb();
    expect(await db.get('preferences', 'pilot')).toMatchObject({ value: { model: 'kept' } });
  });

  it('keeps a usage store that was created ahead of the upgrade', async () => {
    await openLegacy(['sessions', 'memories', 'usage']);
    const db = await openSpiderDb();
    expect([...db.objectStoreNames].filter((name) => name === 'usage')).toEqual(['usage']);
  });

  it('keeps a usageCalls store that was created ahead of the upgrade', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('spider', 3);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        database.createObjectStore('sessions', { keyPath: 'date' });
        database.createObjectStore('memories', { keyPath: 'date' });
        database.createObjectStore('usage', { keyPath: 'date' });
        const calls = database.createObjectStore('usageCalls', { keyPath: 'id' });
        calls.createIndex('date', 'date');
        database.createObjectStore('snapshots', { keyPath: 'id' });
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
    });
    const db = await openSpiderDb();
    expect(db.objectStoreNames.contains('usageCalls')).toBe(true);
    expect([...db.objectStoreNames].filter((name) => name === 'usageCalls')).toEqual([
      'usageCalls',
    ]);
  });

  it('adds the date index to an existing usageCalls store', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('spider', 4);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        database.createObjectStore('sessions', { keyPath: 'date' });
        database.createObjectStore('memories', { keyPath: 'date' });
        database.createObjectStore('usage', { keyPath: 'date' });
        database.createObjectStore('usageCalls', { keyPath: 'id' });
        database.createObjectStore('snapshots', { keyPath: 'id' });
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
    });
    const db = await openSpiderDb();
    const tx = db.transaction('usageCalls');
    expect(tx.store.indexNames.contains('date')).toBe(true);
    await tx.done;
  });

  it('adds the usageCalls store to a database created before it', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('spider', 3);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        database.createObjectStore('sessions', { keyPath: 'date' });
        database.createObjectStore('memories', { keyPath: 'date' });
        database.createObjectStore('usage', { keyPath: 'date' });
        database.createObjectStore('snapshots', { keyPath: 'id' });
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
    });
    const db = await openSpiderDb();
    expect(db.objectStoreNames.contains('usageCalls')).toBe(true);
    expect(db.objectStoreNames.contains('usage')).toBe(true);
  });

  it('keeps a snapshots store that was created ahead of the upgrade', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('spider', 2);
      request.addEventListener('upgradeneeded', () => {
        request.result.createObjectStore('snapshots', { keyPath: 'id' });
      });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('open failed')));
    });
    const db = await openSpiderDb();
    expect(db.objectStoreNames.contains('snapshots')).toBe(true);
    expect(db.objectStoreNames.contains('usage')).toBe(true);
  });
});
