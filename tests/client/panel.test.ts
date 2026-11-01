import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpiderDb } from '../../src/client/journal/db.js';
import { Diary } from '../../src/client/journal/diary.js';
import { shiftDate } from '../../src/client/journal/dates.js';
import { summarizeDiary } from '../../src/client/journal/summarize.js';
import { mountPanel } from '../../src/client/panel.js';
import { readPilot, writePilot, type PilotSettings } from '../../src/client/settings.js';
import type { Stage } from '../../src/client/stage.js';
import type { SimSession } from '../../src/shared/sim/session.js';

const loop = vi.hoisted(() => ({ runAgent: vi.fn() }));

vi.mock('../../src/client/agent/loop.js', () => ({ runAgent: loop.runAgent }));

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

beforeEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  history.replaceState(null, '', '/');
  loop.runAgent.mockReset();
  stage = { setOverlook: vi.fn(), voice: vi.fn(), follow: vi.fn() };
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
    loop.runAgent.mockResolvedValue('unused');
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
      return '';
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
    loop.runAgent.mockResolvedValue(' 完成 ');
    mount();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(document.querySelector('#trace')!.textContent).toBe('完成');
  });

  it('stays quiet for a blank answer', async () => {
    ready();
    loop.runAgent.mockResolvedValue('   ');
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
      return '';
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
      return '';
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
      return '';
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
          signal.addEventListener('abort', () => resolve(''));
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
            signal.addEventListener('abort', () => resolve(''));
          });
        }
        onEvent({ type: 'text', text: '新的' });
        return Promise.resolve('');
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
        return Promise.resolve('');
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
      return '';
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
      return '';
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
      return '';
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
      return '';
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
    loop.runAgent.mockResolvedValue('');
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
    loop.runAgent.mockResolvedValue('');
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
    loop.runAgent.mockResolvedValue('');
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    await flush();
    expect(loop.runAgent).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('asks to summarize after a quiet spell', async () => {
    await seedDay();
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(180000);
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(true);
  });

  it('does not ask to summarize when nothing is behind', async () => {
    await seedDay(false);
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(180000);
    expect(document.querySelector<HTMLDialogElement>('#leave')!.open).toBe(false);
  });

  it('does not open leave when it is already open', async () => {
    await seedDay();
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    document.querySelector<HTMLDialogElement>('#leave')!.open = true;
    await vi.advanceTimersByTimeAsync(180000);
    expect(show).not.toHaveBeenCalled();
    show.mockRestore();
  });

  it('does not ask to leave during a run', async () => {
    await seedDay();
    vi.useFakeTimers();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    loop.runAgent.mockImplementation(() => new Promise(() => {}));
    ready();
    document.querySelector<HTMLInputElement>('#goal')!.value = 'go';
    submit();
    const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    await vi.advanceTimersByTimeAsync(180000);
    expect(show).not.toHaveBeenCalled();
    show.mockRestore();
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
