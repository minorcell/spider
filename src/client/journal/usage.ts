import type { LanguageModelUsage } from 'ai';
import { localDate, shiftDate } from '../../shared/dates.js';
import {
  openSpiderDb,
  type UsageCall,
  type UsageDay,
  type UsageKind,
  type UsageTool,
} from './db.js';

export type { UsageCall, UsageDay, UsageKind, UsageTool };

export type UsageRange = '7' | '30' | 'all';

export interface UsageCallMeta {
  kind?: UsageKind;
  sessionId?: string;
  turnId?: string;
  provider?: string;
  modelId?: string;
}

export interface StepUsageSource {
  callId?: string;
  stepNumber?: number;
  model?: { provider?: string; modelId?: string };
  usage?: LanguageModelUsage | null;
  finishReason?: string;
  toolCalls?: Array<{ toolCallId?: string; toolName?: string; input?: unknown }>;
  toolResults?: Array<{ toolCallId?: string; output?: unknown }>;
  performance?: {
    timeToFirstOutputMs?: number;
    responseTimeMs?: number;
    stepTimeMs?: number;
    toolExecutionMs?: Readonly<Record<string, number>>;
  };
}

export interface UsageKpis {
  calls: number;
  toolCalls: number;
  toolNames: number;
  toolOkRate: number;
  cacheHitRate: number;
  cacheRead: number;
  cacheWrite: number;
  input: number;
  output: number;
  text: number;
  reasoning: number;
  previousCalls: number | null;
}

export interface UsageModelRow {
  modelId: string;
  provider: string;
  calls: number;
  total: number;
  input: number;
  output: number;
  responseMs: number;
  timedCalls: number;
}

export interface UsageToolRow {
  name: string;
  calls: number;
  ok: number;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
}

export interface UsageSnapshot {
  today: UsageDay;
  sum: UsageDay;
  days: UsageDay[];
  range: UsageRange;
  chart: UsageDay[];
  kpis: UsageKpis;
  models: UsageModelRow[];
  tools: UsageToolRow[];
  requests: UsageCall[];
  requestTotal: number;
}

const REQUEST_LIMIT = 200;

export async function recordUsage(
  usage: LanguageModelUsage | null | undefined,
  now = new Date(),
  meta: UsageCallMeta = {},
): Promise<void> {
  const call = usageCallFromUsage(usage, now, meta);
  if (!call) return;
  await recordUsageCall(call);
}

type SpiderDb = Awaited<ReturnType<typeof openSpiderDb>>;

export async function recordUsageCalls(calls: UsageCall[]): Promise<void> {
  if (calls.length === 0) return;
  const next = calls.map(normalizeCall);
  try {
    const db = await openSpiderDb();
    const tx = db.transaction(['usageCalls', 'usage'], 'readwrite');
    const callStore = tx.objectStore('usageCalls');
    const dayStore = tx.objectStore('usage');
    for (const [date, batch] of groupCalls(next)) {
      const stored = new Map<string, UsageCall>();
      for (const row of await callStore.index('date').getAll(date)) {
        const call = normalizeCall(row);
        stored.set(call.id, call);
      }
      for (const call of batch) {
        stored.set(call.id, call);
        await callStore.put(call);
      }
      await dayStore.put(aggregateDay(date, [...stored.values()]));
    }
    await tx.done;
  } catch {}
}

export async function recordUsageCall(call: UsageCall): Promise<void> {
  await recordUsageCalls([call]);
}

export async function readUsage(today: string, range: UsageRange = 'all'): Promise<UsageSnapshot> {
  const db = await openSpiderDb();
  const span = range === '7' ? 7 : range === '30' ? 30 : 0;
  const currentFrom = span === 0 ? null : shiftDate(today, 1 - span);
  const loadFrom = span === 0 ? null : shiftDate(today, 1 - span * 2);
  const [storedRows, callRows] = await Promise.all([
    readDays(db, loadFrom, today),
    readCalls(db, loadFrom, today),
  ]);
  const stored = storedRows
    .map((day) => normalize(day, day.date))
    .filter((day) => day.date <= today)
    .toSorted((a, b) => b.date.localeCompare(a.date));
  const calls = callRows
    .map(normalizeCall)
    .filter((call) => call.date <= today)
    .toSorted((a, b) => b.ts - a.ts || b.step - a.step);
  const storedByDate = new Map(stored.map((day) => [day.date, day]));
  const byDate = groupCalls(calls);
  const dayOf = (date: string): UsageDay => {
    const listed = byDate.get(date);
    if (listed && listed.length > 0) return aggregateDay(date, listed);
    return storedByDate.get(date) ?? blankUsage(date);
  };
  const currentStored =
    currentFrom == null ? stored : stored.filter((day) => day.date >= currentFrom);
  const currentCalls =
    currentFrom == null ? calls : calls.filter((call) => call.date >= currentFrom);
  const chart = chartDates(today, range, currentStored, currentCalls).map(dayOf);
  const sum = chart.reduce(add, blankUsage(''));
  const previous = span === 0 ? null : previousCallCount(dayOf, today, span);
  return {
    today: dayOf(today),
    sum,
    days: currentStored,
    range,
    chart,
    kpis: kpisOf(sum, currentCalls, previous),
    models: modelsOf(currentCalls),
    tools: toolsOf(currentCalls),
    requests: currentCalls.slice(0, REQUEST_LIMIT),
    requestTotal: currentCalls.length,
  };
}

function readDays(db: SpiderDb, from: string | null, today: string): Promise<UsageDay[]> {
  return from == null ? db.getAll('usage') : db.getAll('usage', IDBKeyRange.bound(from, today));
}

function readCalls(db: SpiderDb, from: string | null, today: string): Promise<UsageCall[]> {
  return from == null
    ? db.getAll('usageCalls')
    : db.getAllFromIndex('usageCalls', 'date', IDBKeyRange.bound(from, today));
}

export function blankUsage(date: string): UsageDay {
  return {
    date,
    input: 0,
    output: 0,
    total: 0,
    calls: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    textTokens: 0,
    toolCalls: 0,
  };
}

export function usageCallFromUsage(
  usage: LanguageModelUsage | null | undefined,
  now: Date,
  meta: UsageCallMeta = {},
): UsageCall | null {
  if (usage == null) return null;
  if (usage.inputTokens == null && usage.outputTokens == null && usage.totalTokens == null) {
    return null;
  }
  const date = localDate(now);
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  const cacheRead = count(usage.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = count(usage.inputTokenDetails?.cacheWriteTokens);
  const reasoning = count(usage.outputTokenDetails?.reasoningTokens);
  const total = usage.totalTokens == null ? input + output : count(usage.totalTokens);
  return {
    id: uniqueId('usage', now),
    ts: now.getTime(),
    date,
    kind: meta.kind === 'summary' ? 'summary' : 'agent',
    sessionId: meta.sessionId ?? date,
    turnId: meta.turnId ?? uniqueId('turn', now),
    step: 0,
    provider: meta.provider ?? '',
    modelId: meta.modelId ?? '',
    total,
    input: {
      total: input,
      noCache: inputDetail(usage.inputTokenDetails?.noCacheTokens, input, cacheRead, cacheWrite),
      cacheRead,
      cacheWrite,
    },
    output: {
      total: output,
      text: outputDetail(usage.outputTokenDetails?.textTokens, output, reasoning),
      reasoning,
    },
    tools: [],
    timing: {},
    finishReason: '',
  };
}

export function usageCallFromStep(
  step: StepUsageSource,
  meta: {
    kind: UsageKind;
    sessionId: string;
    turnId: string;
    date: string;
    ts: number;
    tools?: UsageTool[];
  },
): UsageCall {
  const usage = step.usage;
  const input = count(usage?.inputTokens);
  const output = count(usage?.outputTokens);
  const cacheRead = count(usage?.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = count(usage?.inputTokenDetails?.cacheWriteTokens);
  const reasoning = count(usage?.outputTokenDetails?.reasoningTokens);
  const total = usage?.totalTokens == null ? input + output : count(usage.totalTokens);
  const stepNumber = count(step.stepNumber);
  const tools = meta.tools ?? toolsFromStep(step);
  return {
    id: step.callId ? `${step.callId}:${stepNumber}` : uniqueId('step', new Date(meta.ts)),
    ts: meta.ts,
    date: meta.date,
    kind: meta.kind,
    sessionId: meta.sessionId,
    turnId: meta.turnId,
    step: stepNumber,
    provider: step.model?.provider ?? '',
    modelId: step.model?.modelId ?? '',
    total,
    input: {
      total: input,
      noCache: inputDetail(usage?.inputTokenDetails?.noCacheTokens, input, cacheRead, cacheWrite),
      cacheRead,
      cacheWrite,
    },
    output: {
      total: output,
      text: outputDetail(usage?.outputTokenDetails?.textTokens, output, reasoning),
      reasoning,
    },
    tools: tools.map(normalizeTool),
    timing: {
      ttftMs: optionalCount(step.performance?.timeToFirstOutputMs),
      responseMs: optionalCount(step.performance?.responseTimeMs),
      stepMs: optionalCount(step.performance?.stepTimeMs),
    },
    finishReason: step.finishReason ?? '',
  };
}

export function byteSize(value: unknown): number {
  if (value == null) return 0;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text == null) return 0;
    return new TextEncoder().encode(text).length;
  } catch {
    return 0;
  }
}

function toolsFromStep(step: StepUsageSource): UsageTool[] {
  const results = new Map(
    (step.toolResults ?? []).map((result) => [result.toolCallId ?? '', result]),
  );
  return (step.toolCalls ?? []).map((call) => {
    const id = call.toolCallId ?? '';
    const result = results.get(id);
    return {
      id,
      name: call.toolName ?? '',
      ok: result != null,
      durationMs: count(step.performance?.toolExecutionMs?.[id]),
      inputBytes: byteSize(call.input),
      outputBytes: byteSize(result?.output),
    };
  });
}

function aggregateDay(date: string, calls: UsageCall[]): UsageDay {
  return calls.reduce((day, call) => add(day, deltaOfCall(call)), blankUsage(date));
}

function deltaOfCall(call: UsageCall): UsageDay {
  return {
    date: '',
    input: call.input.total,
    output: call.output.total,
    total: call.total,
    calls: 1,
    cacheRead: call.input.cacheRead,
    cacheWrite: call.input.cacheWrite,
    reasoning: call.output.reasoning,
    textTokens: call.output.text,
    toolCalls: call.tools.length,
  };
}

function add(base: UsageDay, delta: UsageDay): UsageDay {
  return {
    date: base.date,
    input: base.input + delta.input,
    output: base.output + delta.output,
    total: base.total + delta.total,
    calls: base.calls + delta.calls,
    cacheRead: base.cacheRead + delta.cacheRead,
    cacheWrite: base.cacheWrite + delta.cacheWrite,
    reasoning: base.reasoning + delta.reasoning,
    textTokens: base.textTokens + delta.textTokens,
    toolCalls: base.toolCalls + delta.toolCalls,
  };
}

function normalize(value: Partial<UsageDay> | undefined, date: string): UsageDay {
  return {
    date,
    input: count(value?.input),
    output: count(value?.output),
    total: count(value?.total),
    calls: count(value?.calls),
    cacheRead: count(value?.cacheRead),
    cacheWrite: count(value?.cacheWrite),
    reasoning: count(value?.reasoning),
    textTokens: count(value?.textTokens),
    toolCalls: count(value?.toolCalls),
  };
}

function normalizeCall(value: UsageCall): UsageCall {
  const input = value.input ?? { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 };
  const output = value.output ?? { total: 0, text: 0, reasoning: 0 };
  const timing = value.timing ?? {};
  const inputTotal = count(input.total);
  const cacheRead = count(input.cacheRead);
  const cacheWrite = count(input.cacheWrite);
  const outputTotal = count(output.total);
  const reasoning = count(output.reasoning);
  return {
    id: value.id || uniqueId('usage', new Date(count(value.ts))),
    ts: count(value.ts),
    date: value.date ?? '',
    kind: value.kind === 'summary' ? 'summary' : 'agent',
    sessionId: value.sessionId ?? value.date ?? '',
    turnId: value.turnId ?? '',
    step: count(value.step),
    provider: value.provider ?? '',
    modelId: value.modelId ?? '',
    total: count(value.total),
    input: {
      total: inputTotal,
      noCache: inputDetail(input.noCache, inputTotal, cacheRead, cacheWrite),
      cacheRead,
      cacheWrite,
    },
    output: {
      total: outputTotal,
      text: outputDetail(output.text, outputTotal, reasoning),
      reasoning,
    },
    tools: Array.isArray(value.tools) ? value.tools.map(normalizeTool) : [],
    timing: {
      ttftMs: optionalCount(timing.ttftMs),
      responseMs: optionalCount(timing.responseMs),
      stepMs: optionalCount(timing.stepMs),
    },
    finishReason: value.finishReason ?? '',
  };
}

function normalizeTool(tool: UsageTool): UsageTool {
  return {
    id: tool.id ?? '',
    name: tool.name ?? '',
    ok: tool.ok === true,
    durationMs: count(tool.durationMs),
    inputBytes: count(tool.inputBytes),
    outputBytes: count(tool.outputBytes),
  };
}

function chartDates(
  today: string,
  range: UsageRange,
  stored: UsageDay[],
  calls: UsageCall[],
): string[] {
  if (range === '7') return enumerate(shiftDate(today, -6), today);
  if (range === '30') return enumerate(shiftDate(today, -29), today);
  const dates = [...new Set([...stored.map((day) => day.date), ...calls.map((call) => call.date)])];
  return dates.length === 0 ? [today] : dates.toSorted((a, b) => a.localeCompare(b));
}

function enumerate(from: string, to: string): string[] {
  const days: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) days.push(date);
  return days;
}

function groupCalls(calls: UsageCall[]): Map<string, UsageCall[]> {
  const grouped = new Map<string, UsageCall[]>();
  for (const call of calls) {
    const list = grouped.get(call.date);
    if (list) list.push(call);
    else grouped.set(call.date, [call]);
  }
  return grouped;
}

function previousCallCount(dayOf: (date: string) => UsageDay, today: string, span: number): number {
  const prevTo = shiftDate(today, -span);
  let total = 0;
  for (let index = 0; index < span; index++) {
    total += dayOf(shiftDate(prevTo, -index)).calls;
  }
  return total;
}

function kpisOf(sum: UsageDay, calls: UsageCall[], previousCalls: number | null): UsageKpis {
  const tools = calls.flatMap((call) => call.tools);
  const names = new Set(tools.map((tool) => tool.name).filter(Boolean));
  const ok = tools.filter((tool) => tool.ok).length;
  return {
    calls: sum.calls,
    toolCalls: sum.toolCalls,
    toolNames: names.size,
    toolOkRate: tools.length === 0 ? 0 : (ok / tools.length) * 100,
    cacheHitRate: sum.input === 0 ? 0 : (sum.cacheRead / sum.input) * 100,
    cacheRead: sum.cacheRead,
    cacheWrite: sum.cacheWrite,
    input: sum.input,
    output: sum.output,
    text: sum.textTokens,
    reasoning: sum.reasoning,
    previousCalls,
  };
}

function modelsOf(calls: UsageCall[]): UsageModelRow[] {
  const rows = new Map<string, UsageModelRow>();
  for (const call of calls) {
    const key = `${call.provider}\0${call.modelId}`;
    const current = rows.get(key) ?? {
      modelId: call.modelId || '未知模型',
      provider: call.provider,
      calls: 0,
      total: 0,
      input: 0,
      output: 0,
      responseMs: 0,
      timedCalls: 0,
    };
    current.calls += 1;
    current.total += call.total;
    current.input += call.input.total;
    current.output += call.output.total;
    if (call.timing.responseMs != null) {
      current.responseMs += call.timing.responseMs;
      current.timedCalls += 1;
    }
    rows.set(key, current);
  }
  return [...rows.values()].toSorted((a, b) => b.total - a.total || b.calls - a.calls);
}

function toolsOf(calls: UsageCall[]): UsageToolRow[] {
  const rows = new Map<string, UsageToolRow>();
  for (const tool of calls.flatMap((call) => call.tools)) {
    const name = tool.name || '未知工具';
    const current = rows.get(name) ?? {
      name,
      calls: 0,
      ok: 0,
      durationMs: 0,
      inputBytes: 0,
      outputBytes: 0,
    };
    current.calls += 1;
    if (tool.ok) current.ok += 1;
    current.durationMs += tool.durationMs;
    current.inputBytes += tool.inputBytes;
    current.outputBytes += tool.outputBytes;
    rows.set(name, current);
  }
  return [...rows.values()].toSorted((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

function uniqueId(prefix: string, now: Date): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  return `${prefix}:${now.getTime()}:${rand}`;
}

function optionalCount(value: unknown): number | undefined {
  if (value == null) return undefined;
  const parsed = count(value);
  return parsed > 0 ? parsed : undefined;
}

function inputDetail(
  explicit: number | undefined,
  total: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const stored = count(explicit);
  const cached = cacheRead + cacheWrite;
  return stored > 0 || total === cached ? stored : Math.max(0, total - cached);
}

function outputDetail(explicit: number | undefined, total: number, reasoning: number): number {
  const stored = count(explicit);
  return stored > 0 ? stored : Math.max(0, total - reasoning);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
