import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPanel } from '../../src/client/panel.js';
import { readPilot, writePilot } from '../../src/client/settings.js';
import type { Stage } from '../../src/client/stage.js';
import type { SimSession } from '../../src/shared/sim/session.js';

const loop = vi.hoisted(() => ({ runAgent: vi.fn() }));

vi.mock('../../src/client/agent/loop.js', () => ({ runAgent: loop.runAgent }));

const CHROME = `
  <form id="pilot">
    <input id="goal" />
    <button id="pilot-send" type="button">发送</button>
  </form>
  <span id="pilot-model"></span>
  <ol id="trace"></ol>
  <button id="settings-open" type="button"></button>
  <button id="observe-open" type="button"></button>
  <span id="look-hint"></span>
  <dialog id="settings">
    <form id="settings-form">
      <input name="baseURL" />
      <input name="model" />
      <input name="apiKey" />
    </form>
    <button id="settings-close" type="button"></button>
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
    window.removeEventListener('error', onError);
    expect(onError).toHaveBeenCalled();
  });

  it('fills, persists, and closes', () => {
    ready();
    mount();
    clickButton('#settings-open');
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
