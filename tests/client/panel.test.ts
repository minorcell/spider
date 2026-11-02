import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpiderDb } from '../../src/client/journal/db.js';
import { Diary } from '../../src/client/journal/diary.js';
import { localDate, shiftDate } from '../../src/client/journal/dates.js';
import * as usageLedger from '../../src/client/journal/usage.js';
import { summarizeDiary } from '../../src/client/journal/summarize.js';
import { AUTO_MEMORY_IDLE_MS, mountPanel } from '../../src/client/panel.js';
import { pendingNow, resetWorldStore, type BootNote } from '../../src/client/worldStore.js';
import { readPilot, writePilot, type PilotSettings } from '../../src/client/settings.js';
import type { Stage } from '../../src/client/stage.js';
import type { SimSession } from '../../src/shared/sim/session.js';

const loop = vi.hoisted(() => ({ runAgent: vi.fn() }));
const restoreHook = vi.hoisted(() => ({
  cb: null as ((note: BootNote) => void) | null,
}));

vi.mock('../../src/client/agent/loop.js', () => ({ runAgent: loop.runAgent }));

vi.mock('../../src/client/worldStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/worldStore.js')>();
  return {
    ...actual,
    onRestore: (cb: (note: BootNote) => void) => {
      restoreHook.cb = cb;
      actual.onRestore(cb);
    },
  };
});

vi.mock('../../src/client/journal/summarize.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/client/journal/summarize.js')>(
    '../../src/client/journal/summarize.js',
  );
  return {
    ...actual,
    summarizeDiary: vi.fn(async () => ({ line: '记下了', summary: '摘要' })),
  };
});

const CHROME = `
  <form id="pilot">
    <input id="goal" />
    <button id="pilot-send" type="button">发送</button>
  </form>
  <span id="pilot-model"></span>
  <ol id="trace"></ol>
  <button id="settings-open" type="button"></button>
  <menu id="corner-menu" hidden>
    <button id="menu-model" type="button">模型</button>
    <button id="menu-memory" type="button">记忆</button>
    <button id="menu-usage" type="button">用量</button>
  </menu>
  <button id="observe-open" type="button"></button>
  <span id="look-hint"></span>
  <dialog id="settings">
    <form id="settings-form">
      <input name="baseURL" />
      <input name="model" />
      <input name="apiKey" />
      <input name="contextTokens" />
      <input name="compact" type="checkbox" />
      <input name="compactKb" />
    </form>
    <button id="settings-close" type="button"></button>
  </dialog>
  <dialog id="memory">
    <form id="memory-form">
      <input name="autoMemory" type="checkbox" />
      <select name="date"></select>
      <input name="line" />
      <textarea name="noted"></textarea>
      <textarea name="summary"></textarea>
    </form>
    <p id="memory-empty" hidden></p>
    <button id="memory-close" type="button"></button>
  </dialog>
  <dialog id="leave">
    <button id="leave-close" type="button"></button>
    <button id="leave-summarize" type="button"></button>
  </dialog>
  <dialog id="usage">
    <p id="usage-today"></p>
    <p id="usage-total"></p>
    <ol id="usage-days"></ol>
    <p id="usage-empty" hidden></p>
    <button id="usage-close" type="button"></button>
  </dialog>
`;

let stage: {
  setOverlook: ReturnType<typeof vi.fn>;
  voice: ReturnType<typeof vi.fn>;
  follow: ReturnType<typeof vi.fn>;
};

function fakeStage(): Stage {
  return stage as unknown as Stage;
}

function fakeSession(): SimSession {
  return {} as SimSession;
}

function ready(): void {
  writePilot({ baseURL: 'https://example.com', model: 'model-1', apiKey: 'key' });
}

function mount(withHint = true): void {
  document.body.innerHTML = CHROME;
  if (!withHint) document.querySelector('#look-hint')!.remove();
  mountPanel(document, fakeSession(), fakeStage());
}

function field(name: string): HTMLInputElement {
  return (
    document.querySelector('#settings-form')!.elements as unknown as Record<
      string,
      HTMLInputElement
    >
  )[name];
}

function submit(): void {
  document
    .querySelector('#pilot')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function clickButton(id: string, detail = 1): void {
  document
    .querySelector(id)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Let promises started by a timer callback settle while the clock is fake. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  history.replaceState(null, '', '/');
  loop.runAgent.mockReset();
  stage = { setOverlook: vi.fn(), voice: vi.fn(), follow: vi.fn(), retile: vi.fn() };
  resetWorldStore();
});

describe('mountPanel chrome', () => {
  it('throws when the chrome is missing', () => {
    document.body.innerHTML = '';
    expect(() => mountPanel(document, fakeSession(), fakeStage())).toThrow('Missing pilot chrome');
  });

  it('paints an empty model until settings are filled', () => {
    mount();
    expect(document.querySelector('#pilot-model')!.textContent).toBe('');
    expect(document.querySelector<HTMLInputElement>('#goal')!.placeholder).toBe('未填写模型');
  });

  it('paints the model when settings are complete', () => {
    ready();
    mount();
    expect(document.querySelector('#pilot-model')!.textContent).toBe('model-1');
    expect(document.querySelector<HTMLInputElement>('#goal')!.placeholder).toBe('让它去做一件事');
  });

  it('opens the map from the hash', () => {
    history.replaceState(null, '', '/#observe');
    mount();
    expect(stage.setOverlook).toHaveBeenCalledWith(true);
    expect(document.querySelector('#look-hint')!.textContent).toBe('拖动平移　滚轮远近');
    expect(document.querySelector('#observe-open')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the map from the #map alias', () => {
    history.replaceState(null, '', '/#map');
    mount();
    expect(stage.setOverlook).toHaveBeenCalledWith(true);
  });

  it('toggles the map and its history entry', () => {
    mount();
    expect(stage.setOverlook).toHaveBeenLastCalledWith(false);
    clickButton('#observe-open');
    expect(stage.setOverlook).toHaveBeenLastCalledWith(true);
    expect(location.hash).toBe('#observe');
    expect(document.querySelector('#look-hint')!.textContent).toBe('拖动平移　滚轮远近');
    clickButton('#observe-open');
    expect(stage.setOverlook).toHaveBeenLastCalledWith(false);
    expect(location.hash).toBe('');
    expect(document.querySelector('#look-hint')!.textContent).toBe('拖动旋转视角　滚轮缩放');
  });

  it('mounts without the optional hint', () => {
    mount(false);
    clickButton('#observe-open');
    expect(stage.setOverlook).toHaveBeenLastCalledWith(true);
  });
});

describe('settings dialog', () => {
  it('rejects a missing settings field', () => {
    const onError = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener('error', onError);
    document.body.innerHTML = CHROME;
    document.querySelector('[name="apiKey"]')!.remove();
    mountPanel(document, fakeSession(), fakeStage());
    clickButton('#settings-open');
    clickButton('#menu-model');
    window.removeEventListener('error', onError);
    expect(onError).toHaveBeenCalled();
  });

  it('fills, persists, and closes', () => {
    ready();
    mount();
    clickButton('#settings-open');
    expect(document.querySelector<HTMLElement>('#corner-menu')!.hidden).toBe(false);
    clickButton('#menu-model');
    expect(field('baseURL').value).toBe('https://example.com');
    expect(document.querySelector<HTMLDialogElement>('#settings')!.open).toBe(true);

    field('model').value = ' next ';
    field('model').dispatchEvent(new Event('input', { bubbles: true }));
    expect(readPilot().model).toBe('next');
    expect(document.querySelector('#pilot-model')!.textContent).toBe('next');

    field('apiKey').value = 'secret';
    document
      .querySelector('#settings-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(readPilot().apiKey).toBe('secret');

    field('baseURL').value = 'https://other.example/';
    clickButton('#settings-close');
    expect(document.querySelector<HTMLDialogElement>('#settings')!.open).toBe(false);
    expect(readPilot().baseURL).toBe('https://other.example');

    document.querySelector('#settings')!.dispatchEvent(new Event('close'));
    expect(readPilot().baseURL).toBe('https://other.example');
  });
});

describe('running a goal', () => {
  it('asks for settings before running', () => {
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    expect(document.querySelector('#trace')!.textContent).toBe('还没有填写模型');
    expect(document.querySelector<HTMLDialogElement>('#settings')!.open).toBe(true);
  });

  it('ignores an empty message', () => {
    ready();
    loop.runAgent.mockResolvedValue({ text: 'unused', usage: null });
    mount();
    submit();
    expect(loop.runAgent).not.toHaveBeenCalled();
    expect(document.querySelector('#trace')!.textContent).toBe('');
  });

  it('streams text into one speech bubble', async () => {
    ready();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'text', text: '' });
      onEvent({ type: 'text', text: '你' });
      onEvent({ type: 'text', text: '好' });
      onEvent({ type: 'unknown' });
      return { text: '', usage: null };
    });
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    const trace = document.querySelector('#trace')!;
    expect(trace.textContent).toBe('你好');
    expect(trace.firstElementChild?.getAttribute('data-kind')).toBe('speech');
    expect(stage.voice).toHaveBeenCalled();
    expect(document.querySelector('#pilot-send')!.textContent).toBe('发送');
  });

  it('shows the final answer when no text streamed', async () => {
    ready();
    loop.runAgent.mockResolvedValue({ text: ' 完成 ', usage: null });
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('完成');
  });

  it('stays quiet for a blank answer', async () => {
    ready();
    loop.runAgent.mockResolvedValue({ text: '   ', usage: null });
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('');
  });

  it('shows a thought for each tool call', async () => {
    ready();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'tool-call', input: { description: '我走过去' } });
      onEvent({ type: 'tool-call', input: { description: 1 } });
      onEvent({ type: 'tool-call', input: { description: '' } });
      onEvent({ type: 'tool-call', input: null });
      onEvent({ type: 'tool-call', input: 'x' });
      onEvent({ type: 'tool-call', input: {} });
      return { text: '', usage: null };
    });
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('我走过去');
    expect(document.querySelector('#trace')!.firstElementChild?.getAttribute('data-kind')).toBe(
      'thought',
    );
  });

  it('translates fetch failures and passes other errors through', async () => {
    ready();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'error', message: 'Failed to fetch' });
      onEvent({ type: 'error', message: 'boom' });
      onEvent({ type: 'error', message: '' });
      return { text: '', usage: null };
    });
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('boom');
  });

  it('translates a fetch failure note', async () => {
    ready();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'error', message: 'TypeError: Failed to fetch' });
      return { text: '', usage: null };
    });
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('不允许浏览器跨域');
  });

  it('reports a thrown error', async () => {
    ready();
    loop.runAgent.mockRejectedValue(new Error('boom'));
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('boom');
  });

  it('reports a thrown non-error', async () => {
    ready();
    loop.runAgent.mockRejectedValue('plain');
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('plain');
  });

  it('stops when the stream finishes after an abort', async () => {
    ready();
    loop.runAgent.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ text: '', usage: null }));
        }),
    );
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    clickButton('#pilot-send', 1);
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('已停止');
  });

  it('stays quiet when a replaced stream finishes after an abort', async () => {
    ready();
    let call = 0;
    loop.runAgent.mockImplementation(
      ({ signal, onEvent }: { signal: AbortSignal; onEvent: (event: unknown) => void }) => {
        call += 1;
        if (call === 1) {
          return new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ text: '', usage: null }));
          });
        }
        onEvent({ type: 'text', text: '新的' });
        return Promise.resolve({ text: '', usage: null });
      },
    );
    mount();
    const goal = document.querySelector<HTMLInputElement>('#goal')!;
    goal.value = 'first';
    submit();
    await flush();
    goal.value = 'second';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('新的');
  });

  it('reports a thrown abort without an aborted signal', async () => {
    ready();
    const abort = new Error('stopped');
    abort.name = 'AbortError';
    loop.runAgent.mockRejectedValue(abort);
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('已停止');
  });

  it('stops the run from the send button', async () => {
    ready();
    loop.runAgent.mockImplementation(
      ({ signal, onEvent }: { signal: AbortSignal; onEvent: (event: unknown) => void }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            onEvent({ type: 'text', text: 'late' });
            const error = new Error('stopped');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    clickButton('#pilot-send', 1);
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('已停止');
    expect(document.querySelector('#pilot-send')!.textContent).toBe('发送');
  });

  it('lets a keyboard activation submit instead of stop', async () => {
    ready();
    loop.runAgent.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('stopped');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    clickButton('#pilot-send', 0);
    await flush();
    expect(document.querySelector('#pilot-send')!.textContent).toBe('停止');
    expect(loop.runAgent).toHaveBeenCalledTimes(1);
  });

  it('quietly replaces a run with a new message', async () => {
    ready();
    let call = 0;
    loop.runAgent.mockImplementation(
      ({ signal, onEvent }: { signal: AbortSignal; onEvent: (event: unknown) => void }) => {
        call += 1;
        if (call === 1) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const error = new Error('stopped');
              error.name = 'AbortError';
              reject(error);
            });
          });
        }
        onEvent({ type: 'text', text: '新的' });
        return Promise.resolve({ text: '', usage: null });
      },
    );
    mount();
    const goal = document.querySelector<HTMLInputElement>('#goal')!;
    goal.value = 'first';
    submit();
    await flush();
    goal.value = 'second';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('新的');
    expect(loop.runAgent).toHaveBeenCalledTimes(2);
    expect(stage.voice).toHaveBeenCalled();
  });

  it('stops on an empty resubmission', async () => {
    ready();
    loop.runAgent.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('stopped');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('已停止');
    expect(loop.runAgent).toHaveBeenCalledTimes(1);
  });
});

describe('speech bubble follow', () => {
  function anchor(): (point: { x: number; y: number } | null) => void {
    return stage.follow.mock.calls[0][0] as (point: { x: number; y: number } | null) => void;
  }

  async function say(text: string): Promise<void> {
    ready();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'text', text });
      return { text: '', usage: null };
    });
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
  }

  it('hides the bubble with no anchor or no text', () => {
    mount();
    const trace = document.querySelector<HTMLElement>('#trace')!;
    anchor()(null);
    expect(trace.hidden).toBe(true);
    anchor()({ x: 400, y: 300 });
    expect(trace.hidden).toBe(true);
  });

  it('places and clamps the bubble above the spider', async () => {
    mount();
    await say('你好');
    const trace = document.querySelector<HTMLElement>('#trace')!;
    Object.defineProperty(trace, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(trace, 'offsetHeight', { configurable: true, value: 40 });
    anchor()({ x: 400, y: 300 });
    expect(trace.hidden).toBe(false);
    expect(trace.style.left).toBe('350px');
    expect(trace.style.top).toBe('244px');
    expect(trace.dataset.tail).toBe('down');
    expect(trace.style.getPropertyValue('--tail')).toBe('50px');
  });

  it('flips the tail below when the bubble would leave the top', async () => {
    mount();
    await say('你好');
    const trace = document.querySelector<HTMLElement>('#trace')!;
    Object.defineProperty(trace, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(trace, 'offsetHeight', { configurable: true, value: 40 });
    anchor()({ x: 400, y: 10 });
    expect(trace.dataset.tail).toBe('up');
    expect(trace.style.top).toBe('26px');
  });

  it('clamps to the viewport edges', async () => {
    mount();
    await say('你好');
    const trace = document.querySelector<HTMLElement>('#trace')!;
    Object.defineProperty(trace, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(trace, 'offsetHeight', { configurable: true, value: 40 });
    anchor()({ x: 5000, y: 5000 });
    expect(trace.style.left).toBe(`${window.innerWidth - 108}px`);
    expect(trace.style.top).toBe(`${window.innerHeight - 48}px`);

    anchor()({ x: 0, y: 300 });
    expect(trace.style.left).toBe('8px');
    expect(trace.style.getPropertyValue('--tail')).toBe('14px');
  });

  it('clears the bubble after it has been idle', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    ready();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'text', text: '你好' });
      return { text: '', usage: null };
    });
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
    const trace = document.querySelector<HTMLElement>('#trace')!;
    Object.defineProperty(trace, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(trace, 'offsetHeight', { configurable: true, value: 40 });
    anchor()({ x: 400, y: 300 });
    expect(trace.hidden).toBe(false);
    expect(trace.textContent).toBe('你好');
    vi.advanceTimersByTime(6000);
    anchor()({ x: 400, y: 300 });
    expect(trace.hidden).toBe(true);
    expect(trace.childElementCount).toBe(0);
  });
});

const PILOT: PilotSettings = {
  baseURL: 'https://example.com',
  model: 'model-1',
  apiKey: 'key',
  contextTokens: null,
  compact: false,
  compactKb: null,
  autoMemory: false,
};

describe('diary panel', () => {
  beforeEach(async () => {
    await resetSpiderDb();
    vi.mocked(summarizeDiary).mockClear();
  });

  async function seedDay(withTurns = true): Promise<Diary> {
    const diary = await Diary.open(new Date());
    if (withTurns) await diary.record('走', '好。', [], PILOT);
    return diary;
  }

  it('opens the memory dialog with the latest page', async () => {
    const day = await seedDay(false);
    await day.write({ date: day.date, line: '不要吃红的', noted: '记住', summary: '摘要' });
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#memory')!.open).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('[name="date"]')!.value).toBe(day.date);
    expect(document.querySelector<HTMLInputElement>('[name="line"]')!.value).toBe('不要吃红的');
    expect(document.querySelector<HTMLTextAreaElement>('[name="noted"]')!.value).toBe('记住');
  });

  it('clears the memory form when there are no pages', async () => {
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    expect(document.querySelector('#memory-empty')!.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>('[name="line"]')!.value).toBe('');
  });

  it('keeps running when the diary cannot open', async () => {
    const spy = vi.spyOn(Diary, 'open').mockRejectedValueOnce(new Error('no db'));
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#memory')!.open).toBe(false);
    spy.mockRestore();
  });

  it('keeps running when the journal hand-off is empty', async () => {
    document.body.innerHTML = CHROME;
    mountPanel(document, fakeSession(), fakeStage(), undefined, Promise.resolve(null));
    await flush();
    clickButton('#menu-memory');
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#memory')!.open).toBe(false);
  });

  it('loads another day when the date changes', async () => {
    const day = await seedDay(false);
    const before = shiftDate(day.date, -1);
    await day.write({ date: before, line: '昨天', noted: '旧话' });
    await day.write({ date: day.date, line: '今天' });
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    const select = document.querySelector<HTMLSelectElement>('[name="date"]')!;
    select.value = before;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(document.querySelector<HTMLInputElement>('[name="line"]')!.value).toBe('昨天');
    expect(document.querySelector<HTMLTextAreaElement>('[name="noted"]')!.value).toBe('旧话');
    select.value = '1999-01-01';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(document.querySelector<HTMLInputElement>('[name="line"]')!.value).toBe('昨天');
  });

  it('writes the memory form', async () => {
    const day = await seedDay(false);
    await day.write({ date: day.date, line: '旧' });
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    document.querySelector<HTMLInputElement>('[name="line"]')!.value = '新的一句';
    document.querySelector<HTMLTextAreaElement>('[name="noted"]')!.value = '记住';
    document
      .querySelector('#memory-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(await day.read(day.date)).toMatchObject({ line: '新的一句', noted: '记住' });
  });

  it('toggles auto memory from the memory dialog', async () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'model-1',
      apiKey: 'key',
      autoMemory: true,
    });
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    const box = document.querySelector<HTMLInputElement>('[name="autoMemory"]')!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(readPilot().autoMemory).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(readPilot().autoMemory).toBe(true);
  });

  it('dismisses the leave dialog', async () => {
    await seedDay();
    mount();
    await flush();
    clickButton('#leave-close');
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(false);
  });

  it('summarizes from the leave dialog', async () => {
    await seedDay();
    ready();
    mount();
    await flush();
    clickButton('#leave-summarize');
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(false);
    expect(summarizeDiary).toHaveBeenCalled();
  });

  it('shows the error when summarizing fails', async () => {
    await seedDay();
    ready();
    vi.mocked(summarizeDiary).mockRejectedValueOnce(new Error('boom'));
    mount();
    await flush();
    clickButton('#leave-summarize');
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('boom');
  });

  it('does not ask to leave when Vite is serving the dev page', async () => {
    vi.stubEnv('MODE', 'development');
    await seedDay();
    mount();
    await flush();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(false);
  });

  it('opens the leave dialog on unload when the day is behind', async () => {
    await seedDay();
    mount();
    await flush();
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(true);
  });

  it('does not open leave on unload when nothing is behind', async () => {
    await seedDay(false);
    mount();
    await flush();
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(false);
  });

  it('saves the diary when the page hides', async () => {
    await seedDay();
    const spy = vi.spyOn(Diary.prototype, 'save');
    mount();
    await flush();
    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('throws when the memory form is missing a field', () => {
    document.body.innerHTML = CHROME;
    document.querySelector('#memory-form [name="date"]')!.remove();
    expect(() => mountPanel(document, fakeSession(), fakeStage())).toThrow('Missing pilot chrome');
  });

  it('fills the compact fields from storage', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'model-1',
      apiKey: 'key',
      contextTokens: 4096,
      compact: true,
      compactKb: 400,
    });
    mount();
    clickButton('#settings-open');
    clickButton('#menu-model');
    expect(field('contextTokens').value).toBe('4096');
    expect(field('compact').checked).toBe(true);
    expect(field('compactKb').value).toBe('400');
    writePilot({ baseURL: 'https://example.com', model: 'model-1', apiKey: 'key' });
    clickButton('#settings-open');
    clickButton('#menu-model');
    expect(field('contextTokens').value).toBe('');
    expect(field('compactKb').value).toBe('');
  });

  it('marks a directory page without a line with its date', async () => {
    const day = await seedDay(false);
    await day.write({ date: shiftDate(day.date, -1), line: '昨天' });
    await day.write({ date: day.date, summary: '有摘要' });
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    const options = [...document.querySelectorAll('#memory-form option')];
    expect(options.map((option) => option.textContent)).toEqual([
      `${shiftDate(day.date, -1)} 昨天`,
      day.date,
    ]);
  });

  it('submits an empty date using today', async () => {
    const day = await seedDay(false);
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    document.querySelector<HTMLInputElement>('[name="line"]')!.value = '空日期';
    document
      .querySelector('#memory-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(await day.read(day.date)).toMatchObject({ line: '空日期' });
  });

  it('ignores the memory and leave buttons before the diary opens', async () => {
    const spy = vi.spyOn(Diary, 'open').mockRejectedValueOnce(new Error('no db'));
    mount();
    await flush();
    clickButton('#menu-memory');
    await flush();
    document
      .querySelector('#memory-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    clickButton('#leave-close');
    clickButton('#leave-summarize');
    clickButton('#memory-close');
    expect(document.querySelector<HTMLDialogElement>('#memory')!.open).toBe(false);
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(false);
    spy.mockRestore();
  });

  it('shows a non-error when summarizing fails oddly', async () => {
    await seedDay();
    ready();
    vi.mocked(summarizeDiary).mockRejectedValueOnce('plain');
    mount();
    await flush();
    clickButton('#leave-summarize');
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('plain');
  });

  it('stops quietly when aborted before the diary opens', async () => {
    ready();
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    clickButton('#pilot-send');
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('已停止');
  });

  it('records tool results and error events', async () => {
    ready();
    mount();
    await flush();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'tool-call', name: 'pick_up', input: { description: '拿' } });
      onEvent({ type: 'tool-result', name: 'pick_up', output: { ok: true } });
      onEvent({ type: 'tool-result', name: 'drop', output: { ok: true } });
      onEvent({ type: 'error', message: 'boom' });
      return { text: '', usage: null };
    });
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('boom');
  });

  it('ignores events that arrive after an abort', async () => {
    ready();
    mount();
    await flush();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      onEvent({ type: 'text', text: '晚了' });
      return { text: '', usage: null };
    });
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    clickButton('#pilot-send');
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('已停止');
    expect(document.querySelector('#trace')!.textContent).not.toContain('晚了');
  });

  it('reports a diary write failure', async () => {
    ready();
    await seedDay();
    vi.spyOn(Diary.prototype, 'record').mockRejectedValueOnce('disk');
    mount();
    await flush();
    loop.runAgent.mockResolvedValue({ text: '', usage: null });
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('disk');
  });

  it('reports a diary write error', async () => {
    ready();
    await seedDay();
    vi.spyOn(Diary.prototype, 'record').mockRejectedValueOnce(new Error('disk full'));
    mount();
    await flush();
    loop.runAgent.mockResolvedValue({ text: '', usage: null });
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toContain('disk full');
  });

  it('stops a replaced run quietly before the diary opens', async () => {
    ready();
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'again';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).not.toContain('已停止');
  });

  it('keeps going when the morning backfill fails', async () => {
    vi.spyOn(Diary.prototype, 'backfill').mockRejectedValueOnce(new Error('no model'));
    mount();
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#memory')!.open).toBe(false);
  });

  it('runs without a diary', async () => {
    ready();
    const spy = vi.spyOn(Diary, 'open').mockRejectedValueOnce(new Error('no db'));
    mount();
    await flush();
    loop.runAgent.mockResolvedValue({ text: '', usage: null });
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(loop.runAgent).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not open the leave dialog after a long quiet spell', async () => {
    await seedDay();
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS * 2);
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(false);
  });

  it('writes the diary after a long idle when auto memory is on', async () => {
    await seedDay();
    ready();
    writePilot({ ...readPilot(), autoMemory: true });
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(summarizeDiary).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS);
    await settle();
    expect(summarizeDiary).toHaveBeenCalledTimes(1);
  });

  it('leaves the diary alone when auto memory is off', async () => {
    await seedDay();
    ready();
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS * 2);
    expect(summarizeDiary).not.toHaveBeenCalled();
  });

  it('does not auto-memorize without a diary', async () => {
    ready();
    writePilot({ ...readPilot(), autoMemory: true });
    const spy = vi.spyOn(Diary, 'open').mockRejectedValueOnce(new Error('no db'));
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS);
    expect(summarizeDiary).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not auto-memorize when nothing is behind', async () => {
    await seedDay(false);
    ready();
    writePilot({ ...readPilot(), autoMemory: true });
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS);
    expect(summarizeDiary).not.toHaveBeenCalled();
  });

  it('waits for a fresh idle stretch after activity', async () => {
    await seedDay();
    ready();
    writePilot({ ...readPilot(), autoMemory: true });
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS - 60_000);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS - 60_000);
    expect(summarizeDiary).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(summarizeDiary).toHaveBeenCalledTimes(1);
  });

  it('does not auto-memorize during a run', async () => {
    await seedDay();
    ready();
    writePilot({ ...readPilot(), autoMemory: true });
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    loop.runAgent.mockImplementation(() => new Promise(() => {}));
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS * 2);
    expect(summarizeDiary).not.toHaveBeenCalled();
  });

  it('does not start a second digest while one is running', async () => {
    await seedDay();
    ready();
    writePilot({ ...readPilot(), autoMemory: true });
    let release!: () => void;
    vi.mocked(summarizeDiary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ line: '记下了', summary: '摘要' });
        }),
    );
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS);
    await settle();
    expect(summarizeDiary).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS);
    await settle();
    expect(summarizeDiary).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  it('backs off after a failed digest', async () => {
    await seedDay();
    ready();
    writePilot({ ...readPilot(), autoMemory: true });
    vi.mocked(summarizeDiary).mockRejectedValueOnce(new Error('boom'));
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS);
    await settle();
    expect(summarizeDiary).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_MEMORY_IDLE_MS - 60_000);
    await settle();
    expect(summarizeDiary).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await settle();
    expect(summarizeDiary).toHaveBeenCalledTimes(2);
  });
});

describe('pilot number fields', () => {
  it('stores only positive integers', () => {
    mount();
    clickButton('#settings-open');
    clickButton('#menu-model');
    const input = field('contextTokens');
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readPilot().contextTokens).toBeNull();
    input.value = '12.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readPilot().contextTokens).toBeNull();
    input.value = '4096';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readPilot().contextTokens).toBe(4096);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readPilot().contextTokens).toBeNull();
  });
});

const reported = {
  inputTokens: 1500,
  outputTokens: 2_500_000,
  totalTokens: 1_200_000_000,
  inputTokenDetails: { noCacheTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: 2_500_000, reasoningTokens: 0 },
};

describe('usage dialog', () => {
  beforeEach(async () => {
    await resetSpiderDb();
  });

  it('opens an empty ledger', async () => {
    mount();
    clickButton('#settings-open');
    clickButton('#menu-usage');
    await flush();
    expect(document.querySelector<HTMLElement>('#corner-menu')!.hidden).toBe(true);
    expect(document.querySelector<HTMLDialogElement>('#usage')!.open).toBe(true);
    expect(document.querySelector('#usage-today')!.textContent).toBe(
      '输入 0\n输出 0\n合计 0\n0 次',
    );
    expect(document.querySelector('#usage-empty')!.hidden).toBe(false);
    clickButton('#usage-close');
    expect(document.querySelector<HTMLDialogElement>('#usage')!.open).toBe(false);
  });

  it('renders an empty ledger when the diary cannot open', async () => {
    vi.spyOn(Diary, 'open').mockRejectedValueOnce(new Error('no db'));
    mount();
    await flush();
    clickButton('#menu-usage');
    await flush();
    expect(document.querySelector<HTMLDialogElement>('#usage')!.open).toBe(true);
    expect(document.querySelector('#usage-today')!.textContent).toContain('0 次');
  });

  it('shows compacted totals and days', async () => {
    const today = localDate(new Date());
    const [year, month, day] = shiftDate(today, -1).split('-').map(Number);
    await usageLedger.recordUsage(reported, new Date());
    await usageLedger.recordUsage(
      { ...reported, inputTokens: 1000, outputTokens: 0, totalTokens: 1000 },
      new Date(year, month - 1, day, 12),
    );
    mount();
    clickButton('#menu-usage');
    await flush();
    const todayText = document.querySelector('#usage-today')!.textContent;
    expect(todayText).toContain('输入 1.5k');
    expect(todayText).toContain('输出 2.5m');
    expect(todayText).toContain('合计 1.2b');
    expect(todayText).toContain('1 次');
    expect(document.querySelector('#usage-total')!.textContent).toContain('2 次');
    expect(document.querySelector('#usage-days')!.textContent).toContain(today);
    expect(document.querySelector('#usage-days')!.textContent).toContain('1.2b');
    expect(document.querySelector('#usage-days')!.textContent).toContain(shiftDate(today, -1));
    expect(document.querySelector('#usage-empty')!.hidden).toBe(true);
  });

  it('refreshes an open ledger after a reply', async () => {
    ready();
    loop.runAgent.mockResolvedValue({ text: '好', usage: reported });
    mount();
    clickButton('#menu-usage');
    await flush();
    expect(document.querySelector('#usage-today')!.textContent).toContain('0 次');
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#usage-today')!.textContent).toContain('输入 1.5k');
    expect(document.querySelector('#usage-today')!.textContent).toContain('1 次');
  });

  it('keeps tokens from a stopped reply', async () => {
    ready();
    loop.runAgent.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ text: '', usage: reported }));
        }),
    );
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    clickButton('#pilot-send', 1);
    await flush();
    clickButton('#menu-usage');
    await flush();
    expect(document.querySelector('#usage-today')!.textContent).toContain('输入 1.5k');
  });

  it('shows an empty ledger when the read fails', async () => {
    vi.spyOn(usageLedger, 'readUsage').mockRejectedValueOnce(new Error('down'));
    mount();
    clickButton('#menu-usage');
    await flush();
    expect(document.querySelector('#usage-today')!.textContent).toBe(
      '输入 0\n输出 0\n合计 0\n0 次',
    );
    expect(document.querySelector('#usage-empty')!.hidden).toBe(false);
  });
});

describe('saved sentence', () => {
  it('puts an unfinished sentence back in the box', () => {
    document.body.innerHTML = CHROME;
    mountPanel(document, fakeSession(), fakeStage(), {
      restored: true,
      cause: null,
      pendingText: '去巢边',
    });
    expect(document.querySelector<HTMLInputElement>('#goal')!.value).toBe('去巢边');
    expect(document.querySelector('#trace')!.textContent).toBe('上次没做完。这句话还在框里。');
  });

  it('says when the snapshot cannot be read', () => {
    document.body.innerHTML = CHROME;
    mountPanel(document, fakeSession(), fakeStage(), {
      restored: false,
      cause: 'malformed',
      pendingText: null,
    });
    expect(document.querySelector('#trace')!.textContent).toBe(
      '上次的地方读不出来，这是一片新的。',
    );
    document.body.innerHTML = CHROME;
    mountPanel(document, fakeSession(), fakeStage(), {
      restored: false,
      cause: 'format',
      pendingText: null,
    });
    expect(document.querySelector('#trace')!.textContent).toBe(
      '这只蜘蛛是更新的页面留下的，这个页面接不上。',
    );
  });

  it('keeps the sentence until the diary write lands', async () => {
    ready();
    loop.runAgent.mockImplementation(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      expect(pendingNow()?.text).toBe('去巢边');
      onEvent({ type: 'tool-call', name: 'look', input: { description: '看' } });
      expect(pendingNow()?.tool).toBe('look');
      onEvent({ type: 'tool-result', name: 'look', output: {} });
      return { text: '到了', usage: null };
    });
    vi.spyOn(Diary.prototype, 'record').mockRejectedValueOnce(new Error('disk'));
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = '去巢边';
    submit();
    await flush();
    expect(pendingNow()?.text).toBe('去巢边');
    expect(document.querySelector('#trace')!.textContent).toBe('disk');
  });

  it('does not let a replaced run clear the new sentence', async () => {
    ready();
    let finishFirst: ((value: { text: string; usage: null }) => void) | undefined;
    let call = 0;
    loop.runAgent.mockImplementation(
      () =>
        new Promise((resolve) => {
          call += 1;
          if (call === 1) finishFirst = resolve;
        }),
    );
    mount();
    const goal = document.querySelector<HTMLInputElement>('#goal')!;
    goal.value = '第一句';
    submit();
    await flush();
    goal.value = '第二句';
    submit();
    await flush();
    expect(pendingNow()?.text).toBe('第二句');
    finishFirst?.({ text: '', usage: null });
    await flush();
    expect(pendingNow()?.text).toBe('第二句');
  });

  it('clears the sentence when the user stops', async () => {
    ready();
    loop.runAgent.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ text: '', usage: null }));
        }),
    );
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = '停下';
    submit();
    await flush();
    expect(pendingNow()?.text).toBe('停下');
    clickButton('#pilot-send', 1);
    await flush();
    expect(pendingNow()).toBeNull();
  });

  it('takes a restored sentence only while the box is untouched', async () => {
    mount();
    await flush();
    const note = (pendingText: string | null): BootNote => ({
      restored: true,
      cause: null,
      pendingText,
    });
    const goal = document.querySelector<HTMLInputElement>('#goal')!;
    restoreHook.cb?.(note('接着走'));
    expect(stage.retile).toHaveBeenCalledTimes(1);
    expect(goal.value).toBe('接着走');

    goal.value = '自己写的';
    goal.dispatchEvent(new Event('input'));
    restoreHook.cb?.(note('旧的'));
    expect(goal.value).toBe('自己写的');

    restoreHook.cb?.(note(null));
    expect(stage.retile).toHaveBeenCalledTimes(3);
  });
});
