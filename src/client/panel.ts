import { pilotReady, readPilot, writePilot, type PilotSettings } from './settings.js';
import type { Stage } from './stage.js';
import type { SimSession } from '../shared/sim/session.js';

const BUBBLE_MS = 5000;

/** Settings, the instruction box, and the bubble that follows the spider. */
export function mountPanel(doc: Document, session: SimSession, stage: Stage): void {
  const form = doc.querySelector<HTMLFormElement>('#pilot');
  const goal = doc.querySelector<HTMLInputElement>('#goal');
  const send = doc.querySelector<HTMLButtonElement>('#pilot-send');
  const model = doc.querySelector<HTMLElement>('#pilot-model');
  const trace = doc.querySelector<HTMLOListElement>('#trace');
  const open = doc.querySelector<HTMLButtonElement>('#settings-open');
  const map = doc.querySelector<HTMLButtonElement>('#observe-open');
  const lookHint = doc.querySelector<HTMLElement>('#look-hint');
  const dialog = doc.querySelector<HTMLDialogElement>('#settings');
  const settingsForm = doc.querySelector<HTMLFormElement>('#settings-form');
  const close = doc.querySelector<HTMLButtonElement>('#settings-close');
  if (
    !form ||
    !goal ||
    !send ||
    !model ||
    !trace ||
    !open ||
    !map ||
    !dialog ||
    !settingsForm ||
    !close
  ) {
    throw new Error('Missing pilot chrome');
  }

  const showMap = (on: boolean): void => {
    map.setAttribute('aria-pressed', on ? 'true' : 'false');
    stage.setOverlook(on);
    if (lookHint) lookHint.textContent = on ? '拖动平移　滚轮远近' : '拖动旋转视角　滚轮缩放';
  };

  showMap(location.hash === '#observe' || location.hash === '#map');
  map.addEventListener('click', () => {
    const on = map.getAttribute('aria-pressed') !== 'true';
    history.replaceState(null, '', on ? '#observe' : location.pathname + location.search);
    showMap(on);
  });

  let current: AbortController | null = null;
  /** Runs replaced by a new message. They stop quietly, without a "已停止" note. */
  const replaced = new WeakSet<AbortController>();
  let live: HTMLLIElement | null = null;
  let hideAt = 0;

  const paint = (): void => {
    const settings = readPilot();
    const ready = pilotReady(settings);
    model.textContent = ready ? settings.model : '';
    goal.placeholder = ready ? '让它去做一件事' : '未填写模型';
  };

  const touch = (): void => {
    hideAt = performance.now() + BUBBLE_MS;
  };

  const show = (text: string, kind: string): void => {
    const line = text.trim();
    if (!line) return;
    trace.replaceChildren();
    live = doc.createElement('li');
    live.dataset.kind = kind;
    live.textContent = line;
    trace.append(live);
    touch();
    if (kind === 'speech' || kind === 'thought') stage.voice();
  };

  const say = (chunk: string): void => {
    if (!chunk) return;
    if (live?.dataset.kind !== 'speech') {
      trace.replaceChildren();
      live = doc.createElement('li');
      live.dataset.kind = 'speech';
      live.textContent = '';
      trace.append(live);
    }
    /* v8 ignore next */
    live.textContent = `${live.textContent ?? ''}${chunk}`;
    touch();
    stage.voice();
  };

  const field = (name: string): HTMLInputElement => {
    const element = settingsForm.elements.namedItem(name);
    if (!(element instanceof HTMLInputElement)) throw new Error(`Missing settings field ${name}`);
    return element;
  };

  const fill = (settings: PilotSettings): void => {
    field('baseURL').value = settings.baseURL;
    field('model').value = settings.model;
    field('apiKey').value = settings.apiKey;
  };

  open.addEventListener('click', () => {
    fill(readPilot());
    dialog.showModal();
  });
  close.addEventListener('click', () => dialog.close());

  const persist = (): void => {
    writePilot({
      baseURL: field('baseURL').value,
      model: field('model').value,
      apiKey: field('apiKey').value,
    });
    paint();
  };

  settingsForm.addEventListener('input', persist);
  settingsForm.addEventListener('submit', persist);
  dialog.addEventListener('close', persist);

  const run = async (
    controller: AbortController,
    text: string,
    settings: PilotSettings,
  ): Promise<void> => {
    let sawText = false;
    try {
      const { runAgent } = await import('./agent/loop.js');
      const answer = await runAgent({
        goal: text,
        session,
        settings,
        signal: controller.signal,
        onEvent(event) {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case 'text':
              sawText = true;
              say(event.text);
              break;
            case 'tool-call':
              show(thoughtOf(event.input), 'thought');
              break;
            case 'error':
              show(explain(event.message), 'note');
              break;
            default:
              break;
          }
        },
      });
      if (controller.signal.aborted) {
        if (!replaced.has(controller)) show('已停止', 'note');
      } else if (!sawText && answer.trim()) show(answer.trim(), 'speech');
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) {
        if (!replaced.has(controller)) show('已停止', 'note');
      } else show(explain(error instanceof Error ? error.message : String(error)), 'note');
    } finally {
      if (current === controller) {
        current = null;
        send.textContent = '发送';
      }
    }
  };

  // A click on 停止 aborts. Enter submits, and a typed message replaces the run.
  // Keyboard activation of this button reports detail 0, so Enter still submits.
  send.addEventListener('click', (event) => {
    if (!current || event.detail === 0) return;
    event.preventDefault();
    current.abort();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = goal.value.trim();
    if (current) {
      if (text) replaced.add(current);
      current.abort();
      if (!text) return;
    }

    const settings = readPilot();
    if (!pilotReady(settings)) {
      show('还没有填写模型', 'note');
      fill(settings);
      dialog.showModal();
      return;
    }
    if (!text) return;

    const controller = new AbortController();
    current = controller;
    send.textContent = '停止';
    goal.value = '';
    live = null;
    hideAt = 0;
    trace.replaceChildren();

    void run(controller, text, settings);
  });

  let bubbleText = '';
  let bubbleWidth = 0;
  let bubbleHeight = 0;

  stage.follow((point) => {
    if (hideAt > 0 && performance.now() >= hideAt) {
      trace.replaceChildren();
      live = null;
      hideAt = 0;
    }
    if (!point || trace.childElementCount === 0) {
      trace.hidden = true;
      return;
    }
    /* v8 ignore next */
    const text = trace.textContent ?? '';
    if (trace.hidden || text !== bubbleText) {
      trace.hidden = false;
      bubbleWidth = trace.offsetWidth;
      bubbleHeight = trace.offsetHeight;
      bubbleText = text;
    }
    const width = bubbleWidth;
    const height = bubbleHeight;
    let left = point.x - width / 2;
    let top = point.y - height - 16;
    let tail = 'down';
    if (top < 8) {
      top = point.y + 16;
      tail = 'up';
    }
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    trace.style.left = `${left}px`;
    trace.style.top = `${top}px`;
    const tailX = Math.max(14, Math.min(width - 14, point.x - left));
    trace.style.setProperty('--tail', `${tailX}px`);
    trace.dataset.tail = tail;
  });

  paint();
}

function thoughtOf(input: unknown): string {
  if (!input || typeof input !== 'object' || !('description' in input)) return '';
  const description = input.description;
  return typeof description === 'string' ? description : '';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function explain(message: string): string {
  if (message === 'Failed to fetch' || message.includes('Failed to fetch')) {
    return '请求没有发出去。这个地址可能不允许浏览器跨域。';
  }
  return message;
}
