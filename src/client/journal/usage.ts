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
  /** Stored days in the range, newest first. */
  days: UsageDay[];
  range: UsageRange;
  chart: UsageDay[];
  kpis: UsageKpis;
  models: UsageModelRow[];
  tools: UsageToolRow[];
  requests: UsageCall[];
}

/** Add one model call to the local day of `now`. Missing usage is ignored. */
export async function recordUsage(
  usage: LanguageModelUsage | null | undefined,
  now = new Date(),
  meta: UsageCallMeta = {},
): Promise<void> {
  const call = usageCallFromUsage(usage, now, meta);
  if (!call) return;
  await recordUsageCall(call);
}

/** Persist one model step. A failed write does not affect the conversation. */
export async function recordUsageCall(call: UsageCall): Promise<void> {
  const next = normalizeCall(call);
  try {
    const db = await openSpiderDb();
    const tx = db.transaction(['usageCalls', 'usage'], 'readwrite');
    const calls = tx.objectStore('usageCalls');
    const days = tx.objectStore('usage');
    const existing = await calls.index('date').getAll(next.date);
    if (existing.length === 0) {
      const prior = normalize(await days.get(next.date), next.date);
      if (prior.calls > 0) await calls.put(legacyCallFromDay(prior));
    }
    await calls.put(next);
    const stored = await calls.index('date').getAll(next.date);
    await days.put(aggregateDay(next.date, stored.map(normalizeCall)));
    await tx.done;
  } catch {
    // The conversation still stands when the ledger cannot be written.
  }
}

/** Today's row, the sum of stored days in range, and those days newest first. */
export async function readUsage(today: string, range: UsageRange = 'all'): Promise<UsageSnapshot> {
  const db = await openSpiderDb();
  const stored = (await db.getAll('usage')).map((day) => normalize(day, day.date));
  const calls = (await db.getAll('usageCalls')).map(normalizeCall);
  const from = rangeFrom(today, range, stored, calls);
  const storedIn = stored
    .filter((day) => day.date >= from && day.date <= today)
    .toSorted((a, b) => b.date.localeCompare(a.date));
  const callsIn = calls
    .filter((call) => call.date >= from && call.date <= today)
    .toSorted((a, b) => b.ts - a.ts || b.step - a.step);
  const byDate = groupCalls(callsIn);
  const storedByDate = new Map(stored.map((day) => [day.date, day]));
  const dayOf = (date: string): UsageDay => {
    const listed = byDate.get(date);
    if (listed && listed.length > 0) return aggregateDay(date, listed);
    return storedByDate.get(date) ?? blankUsage(date);
  };
  const chart = chartDates(today, range, storedIn, callsIn).map(dayOf);
  const sum = (range === 'all' ? storedIn : chart).reduce(add, blankUsage(''));
  const todayRow = dayOf(today);
  const previousCalls = previousCallCount(today, range, stored, calls);
  return {
    today: todayRow,
    sum: range === 'all' ? sum : chart.reduce(add, blankUsage('')),
    days: storedIn,
    range,
    chart,
    kpis: kpisOf(sum, callsIn, previousCalls),
    models: modelsOf(callsIn),
    tools: toolsOf(callsIn),
    requests: callsIn,
  };
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
  const noCache = count(usage.inputTokenDetails?.noCacheTokens);
  const text = count(usage.outputTokenDetails?.textTokens);
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
    input: { total: input, noCache, cacheRead, cacheWrite },
    output: { total: output, text, reasoning },
    tools: [],
    timing: { responseMs: 0, stepMs: 0 },
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
  const noCache = count(usage?.inputTokenDetails?.noCacheTokens);
  const text = count(usage?.outputTokenDetails?.textTokens);
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
    input: { total: input, noCache, cacheRead, cacheWrite },
    output: { total: output, text, reasoning },
    tools: tools.map(normalizeTool),
    timing: {
      ttftMs: optionalCount(step.performance?.timeToFirstOutputMs),
      responseMs: count(step.performance?.responseTimeMs),
      stepMs: count(step.performance?.stepTimeMs),
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

function legacyCallFromDay(day: UsageDay): UsageCall {
  return {
    id: `legacy:${day.date}`,
    ts: 0,
    date: day.date,
    kind: 'agent',
    sessionId: day.date,
    turnId: `legacy:${day.date}`,
    step: 0,
    provider: '',
    modelId: '',
    total: day.total,
    input: {
      total: day.input,
      noCache: 0,
      cacheRead: day.cacheRead,
      cacheWrite: day.cacheWrite,
    },
    output: { total: day.output, text: day.textTokens, reasoning: day.reasoning },
    tools: [],
    timing: { responseMs: 0, stepMs: 0 },
    finishReason: '',
  };
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
  const timing = value.timing ?? { responseMs: 0, stepMs: 0 };
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
      total: count(input.total),
      noCache: count(input.noCache),
      cacheRead: count(input.cacheRead),
      cacheWrite: count(input.cacheWrite),
    },
    output: {
      total: count(output.total),
      text: count(output.text),
      reasoning: count(output.reasoning),
    },
    tools: Array.isArray(value.tools) ? value.tools.map(normalizeTool) : [],
    timing: {
      ttftMs: optionalCount(timing.ttftMs),
      responseMs: count(timing.responseMs),
      stepMs: count(timing.stepMs),
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

function rangeFrom(
  today: string,
  range: UsageRange,
  stored: UsageDay[],
  calls: UsageCall[],
): string {
  if (range === '7') return shiftDate(today, -6);
  if (range === '30') return shiftDate(today, -29);
  const dates = [...stored.map((day) => day.date), ...calls.map((call) => call.date)];
  if (dates.length === 0) return today;
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
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

function previousCallCount(
  today: string,
  range: UsageRange,
  stored: UsageDay[],
  calls: UsageCall[],
): number | null {
  const length = range === '7' ? 7 : range === '30' ? 30 : 0;
  if (length === 0) return null;
  const currentFrom = range === '7' ? shiftDate(today, -6) : shiftDate(today, -29);
  const prevTo = shiftDate(currentFrom, -1);
  const prevFrom = shiftDate(prevTo, 1 - length);
  if (calls.length > 0) {
    return calls.filter((call) => call.date >= prevFrom && call.date <= prevTo).length;
  }
  return stored
    .filter((day) => day.date >= prevFrom && day.date <= prevTo)
    .reduce((sum, day) => sum + day.calls, 0);
}

function kpisOf(sum: UsageDay, calls: UsageCall[], previousCalls: number | null): UsageKpis {
  const tools = calls.flatMap((call) => call.tools);
  const names = new Set(tools.map((tool) => tool.name).filter(Boolean));
  const ok = tools.filter((tool) => tool.ok).length;
  const input =
    calls.length > 0 ? calls.reduce((total, call) => total + call.input.total, 0) : sum.input;
  const output =
    calls.length > 0 ? calls.reduce((total, call) => total + call.output.total, 0) : sum.output;
  const cacheRead =
    calls.length > 0
      ? calls.reduce((total, call) => total + call.input.cacheRead, 0)
      : sum.cacheRead;
  const cacheWrite =
    calls.length > 0
      ? calls.reduce((total, call) => total + call.input.cacheWrite, 0)
      : sum.cacheWrite;
  return {
    calls: calls.length > 0 ? calls.length : sum.calls,
    toolCalls: calls.length > 0 ? tools.length : sum.toolCalls,
    toolNames: names.size,
    toolOkRate: tools.length === 0 ? 0 : (ok / tools.length) * 100,
    cacheHitRate: input === 0 ? 0 : (cacheRead / input) * 100,
    cacheRead,
    cacheWrite,
    input,
    output,
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
    };
    current.calls += 1;
    current.total += call.total;
    current.input += call.input.total;
    current.output += call.output.total;
    current.responseMs += call.timing.responseMs;
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
  return count(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
