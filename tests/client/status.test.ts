import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindStatus } from '@/src/client/panel/status';
import { SimSession } from '@/src/shared/sim/session';
import type { Journal } from '@/src/client/journal/api';
import type { PilotSettings } from '@/src/client/settings';

const settings: PilotSettings = {
  provider: 'custom',
  baseURL: '',
  model: 'test',
  apiKey: '',
  contextTokens: 8,
  autoMemory: false,
  thinking: true,
};
let menu: HTMLButtonElement;
let panel: HTMLElement;
let dialog: HTMLDialogElement;
let session: SimSession;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<button id="menu"></button><dialog open><section id="status" hidden></section></dialog>';
  menu = document.querySelector('#menu')!;
  panel = document.querySelector('#status')!;
  dialog = document.querySelector('dialog')!;
  session = new SimSession(3);
});
afterEach(() => vi.useRealTimers());

function setup(journal: Journal | null = null) {
  return bindStatus({
    doc: document,
    menu,
    panel,
    dialog,
    session,
    showPage: () => {
      panel.hidden = false;
    },
    getJournal: () => journal,
    journalReady: Promise.resolve(journal),
  });
}

describe('live status', () => {
  it('shows world and spider state and refreshes only while visible', async () => {
    setup();
    menu.click();
    await Promise.resolve();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('#status-world')!.textContent).toContain('世界种子3');
    expect(panel.querySelector('#status-spider')!.textContent).toContain('在家里');
    expect(panel.querySelector('#status-saved')!.textContent).toContain('没有可用');
    session.spider.root.position.x = 3;
    await vi.advanceTimersByTimeAsync(1000);
    expect(panel.querySelector('#status-spider')!.textContent).toContain('(3,');
    panel.hidden = true;
    session.spider.root.position.x = 4;
    await vi.advanceTimersByTimeAsync(1000);
    expect(panel.querySelector('#status-spider')!.textContent).toContain('(3,');
  });

  it('renders request context, measured token usage and live tool results without mutating the input', () => {
    const status = setup();
    const messages = [{ role: 'user', content: '去后山' }];
    status.start(settings);
    status.event({
      type: 'context',
      step: 0,
      instructions: 'system',
      messages,
      tools: ['observe'],
      local: false,
    });
    expect(panel.querySelector('#status-context')!.textContent).toContain('去后山');
    expect(messages).toEqual([{ role: 'user', content: '去后山' }]);
    status.event({
      type: 'usage',
      step: 0,
      input: 2000,
      output: 100,
      cacheRead: 500,
      cacheWrite: 0,
      reasoning: 0,
    });
    expect(panel.querySelector('#status-context-usage')!.textContent).toContain('25.0%');
    expect(panel.querySelector<HTMLProgressElement>('#status-context-meter')!.value).toBe(25);
    status.event({ type: 'tool-call', name: 'observe', input: { distance: 24 } });
    expect(panel.querySelector('#status-tools')!.textContent).toContain('执行中');
    status.event({ type: 'tool-result', name: 'observe', output: { ok: true, target: 'apple' } });
    expect(panel.querySelector('#status-tools')!.textContent).toContain('apple');
    expect(panel.querySelector('#status-tools')!.textContent).toContain('已返回');
    status.finish('已完成');
    expect(panel.querySelector('#status-phase')!.textContent).toBe('已完成');
  });

  it('handles missing usage, failed and interrupted tools, and local-model limits', () => {
    const status = setup();
    status.start({ ...settings, mode: 'local' });
    status.event({
      type: 'context',
      step: 2,
      instructions: null,
      messages: [],
      tools: [],
      local: true,
    });
    expect(panel.querySelector('#status-context')!.textContent).toContain('本机适配前');
    status.event({
      type: 'usage',
      step: 2,
      input: 2048,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    });
    expect(panel.querySelector('#status-context-usage')!.textContent).toContain('50.0%');
    status.event({
      type: 'usage',
      step: 2,
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    });
    expect(panel.querySelector<HTMLProgressElement>('#status-context-meter')!.hidden).toBe(true);
    status.event({ type: 'tool-call', name: 'go', input: {} });
    status.event({ type: 'error', message: '不可用' });
    expect(panel.querySelector('#status-tools')!.textContent).toContain('失败 · go');
    status.event({ type: 'tool-call', name: 'observe', input: {} });
    status.finish('已停止');
    expect(panel.querySelector('#status-tools')!.textContent).toContain('已停止 · observe');
    status.start({ ...settings, contextTokens: null });
    status.event({
      type: 'usage',
      step: 2,
      input: 100,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    });
    expect(panel.querySelector('#status-context-usage')!.textContent).toContain('未设置上限');
  });

  it('shows saved tool traces when available and handles results without a matching call', async () => {
    const journal = {
      session: {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool-call', toolCallId: '1', toolName: 'mark', input: { name: 'home' } },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: '1',
                toolName: 'mark',
                output: { type: 'json', value: { ok: true } },
              },
            ],
          },
        ],
      },
    } as unknown as Journal;
    const status = setup(journal);
    menu.click();
    await Promise.resolve();
    expect(panel.querySelector('#status-saved')!.textContent).toContain('mark');
    status.event({ type: 'tool-result', name: 'go', output: { ok: false } });
    expect(panel.querySelector('#status-tools')!.textContent).toContain('go');
    status.finish('已完成');
  });

  it('keeps request context and tool history bounded', () => {
    const status = setup();
    for (let i = 0; i < 31; i++) {
      status.event({
        type: 'context',
        step: i,
        instructions: 'system',
        messages: [],
        tools: [],
        local: false,
      });
    }
    expect(panel.querySelector('#status-context')!.childElementCount).toBe(30);
    for (let i = 0; i < 31; i++) {
      status.event({ type: 'tool-result', name: 'go', output: { ok: true } });
    }
    expect(panel.querySelector('#status-tools')!.childElementCount).toBe(30);
  });

  it('handles incomplete, unusual and bounded diagnostic data', async () => {
    const status = setup();
    const normal = session.sense();
    const sense = vi
      .spyOn(session, 'sense')
      .mockReturnValue({ ...normal, x: NaN, home: false, wet: true });
    session.setLamp(true);
    menu.click();
    expect(panel.querySelector('#status-spider')!.textContent).toContain('在水中');
    expect(panel.querySelector('#status-spider')!.textContent).toContain('—');
    sense.mockReturnValue({ ...normal, home: false, wet: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(panel.querySelector('#status-spider')!.textContent).toContain('在陆地');
    status.start({ ...settings, model: '' });
    status.event({
      type: 'context',
      step: 0,
      instructions: undefined,
      messages: null,
      tools: [],
      local: false,
    });
    status.event({
      type: 'context',
      step: 1,
      instructions: '',
      messages: [{}],
      tools: [],
      local: false,
    });
    status.event({
      type: 'usage',
      step: 5,
      input: 1,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    status.event({ type: 'tool-call', name: 'observe', input: undefined });
    status.event({ type: 'tool-result', name: 'observe', output: circular });
    expect(panel.querySelector('#status-tools')!.textContent).toContain('无法显示');
    expect(panel.querySelector('#status-tools')!.textContent).toContain('无');
    for (let i = 0; i < 31; i++) status.event({ type: 'tool-call', name: 'go', input: {} });
    expect(panel.querySelector('#status-tools')!.childElementCount).toBe(30);
    expect(panel.querySelector('#status-tool-distribution')!.textContent).toContain('go');
  });
});
