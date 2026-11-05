import { closeDialog, showDialog } from '../ui/dialog/index.js';
import { placeTail } from '../ui/dress.js';
import type { MenuSelect } from '../ui/select/index.js';
import { enhanceSwitch, reflectSwitch } from '../ui/switch/index.js';
import { openJournal, type Journal, type OpenedJournal } from './journal/api.js';
import { flushSoon, flushWorld, onRestore, setPending, type BootNote } from './worldStore.js';
import type { Trace } from './journal/session.js';
import { bindLeave } from './panel/leave.js';
import { bindMemory } from './panel/memory.js';
import { bindUsage } from './panel/usage.js';
import { explain, isAbort, numberOrNull, thoughtOf } from './panel/helpers.js';
import { pilotReady, readPilot, writePilot, type PilotSettings } from './settings.js';
import type { Stage } from './stage.js';
import type { SimSession } from '../shared/sim/session.js';

const BUBBLE_MS = 5000;
/** How long the page must go untouched before auto memory may run. */
export const AUTO_MEMORY_IDLE_MS = 30 * 60 * 1000;
/** How often to check whether that idle stretch has passed. */
const AUTO_MEMORY_CHECK_MS = 60 * 1000;

/** Settings, the instruction box, and the bubble that follows the spider. */
export function mountPanel(
  doc: Document,
  session: SimSession,
  stage: Stage,
  note?: BootNote,
  injected?: Promise<OpenedJournal | null> | OpenedJournal,
): void {
  const form = doc.querySelector<HTMLFormElement>('#pilot');
  const goal = doc.querySelector<HTMLInputElement>('#goal');
  const send = doc.querySelector<HTMLButtonElement>('#pilot-send');
  const model = doc.querySelector<HTMLElement>('#pilot-model');
  const trace = doc.querySelector<HTMLOListElement>('#trace');
  const open = doc.querySelector<HTMLButtonElement>('#settings-open');
  const menuModel = doc.querySelector<HTMLButtonElement>('#menu-model');
  const menuMemory = doc.querySelector<HTMLButtonElement>('#menu-memory');
  const menuUsage = doc.querySelector<HTMLButtonElement>('#menu-usage');
  const map = doc.querySelector<HTMLButtonElement>('#observe-open');
  const lookHint = doc.querySelector<HTMLElement>('#look-hint');
  const dialog = doc.querySelector<HTMLDialogElement>('#settings');
  const panelModel = doc.querySelector<HTMLElement>('#panel-model');
  const settingsForm = doc.querySelector<HTMLFormElement>('#settings-form');
  const close = doc.querySelector<HTMLButtonElement>('#settings-close');
  const memoryPanel = doc.querySelector<HTMLElement>('#memory');
  const memoryForm = doc.querySelector<HTMLFormElement>('#memory-form');
  const memoryEmpty = doc.querySelector<HTMLElement>('#memory-empty');
  const leave = doc.querySelector<HTMLDialogElement>('#leave');
  const leaveClose = doc.querySelector<HTMLButtonElement>('#leave-close');
  const leaveSummarize = doc.querySelector<HTMLButtonElement>('#leave-summarize');
  const usagePanel = doc.querySelector<HTMLElement>('#usage');
  if (
    !form ||
    !goal ||
    !send ||
    !model ||
    !trace ||
    !open ||
    !menuModel ||
    !menuMemory ||
    !menuUsage ||
    !map ||
    !dialog ||
    !panelModel ||
    !settingsForm ||
    !close ||
    !memoryPanel ||
    !memoryForm ||
    !memoryEmpty ||
    !leave ||
    !leaveClose ||
    !leaveSummarize ||
    !usagePanel
  ) {
    throw new Error('Missing pilot chrome');
  }

  const dateSelect = memoryForm.querySelector<MenuSelect>('input[name="date"]');
  const lineInput = memoryForm.querySelector<HTMLInputElement>('input[name="line"]');
  const notedInput = memoryForm.querySelector<HTMLTextAreaElement>('textarea[name="noted"]');
  const summaryInput = memoryForm.querySelector<HTMLTextAreaElement>('textarea[name="summary"]');
  const autoMemoryInput = memoryForm.querySelector<HTMLInputElement>('input[name="autoMemory"]');
  if (!dateSelect || !lineInput || !notedInput || !summaryInput || !autoMemoryInput) {
    throw new Error('Missing pilot chrome');
  }
  for (const label of doc.querySelectorAll<HTMLLabelElement>('label.check')) {
    enhanceSwitch(label);
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

  let touched = false;
  goal.addEventListener('input', () => {
    touched = true;
  });

  const paint = (): void => {
    const settings = readPilot();
    const ready = pilotReady(settings);
    model.textContent = ready ? settings.model : '';
    model.style.display = ready ? '' : 'none';
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

  if (note?.cause === 'format') show('这只蜘蛛是更新的页面留下的，这个页面接不上。', 'note');
  else if (note?.cause === 'malformed') show('上次的地方读不出来，这是一片新的。', 'note');
  else if (note?.pendingText) {
    goal.value = note.pendingText;
    show('上次没做完。这句话还在框里。', 'note');
  }
  onRestore((arrived) => {
    stage.retile();
    if (touched || !arrived.pendingText) return;
    goal.value = arrived.pendingText;
    show('上次没做完。这句话还在框里。', 'note');
  });

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

  const modelFields = (): {
    baseURL: string;
    model: string;
    apiKey: string;
    contextTokens: string;
    thinking: boolean;
  } => ({
    baseURL: field('baseURL').value,
    model: field('model').value,
    apiKey: field('apiKey').value,
    contextTokens: field('contextTokens').value,
    thinking: field('thinking').checked,
  });
  let shownFields: ReturnType<typeof modelFields> | null = null;

  const fill = (settings: PilotSettings): void => {
    field('baseURL').value = settings.baseURL;
    field('model').value = settings.model;
    field('apiKey').value = settings.apiKey;
    field('contextTokens').value =
      settings.contextTokens == null ? '' : String(settings.contextTokens);
    field('thinking').checked = settings.thinking;
    reflectSwitch(field('thinking'));
    shownFields = modelFields();
  };

  const pages = { model: panelModel, memory: memoryPanel, usage: usagePanel } as const;
  const nav = { model: menuModel, memory: menuMemory, usage: menuUsage } as const;

  const showPage = (page: keyof typeof pages): void => {
    for (const name of Object.keys(pages) as Array<keyof typeof pages>) {
      pages[name].hidden = name !== page;
      if (name === page) nav[name].setAttribute('aria-current', 'page');
      else nav[name].removeAttribute('aria-current');
    }
    open.setAttribute('aria-expanded', 'true');
    showDialog(dialog);
  };

  open.addEventListener('click', () => {
    if (dialog.open) {
      closeDialog(dialog);
      return;
    }
    fill(readPilot());
    showPage('model');
  });
  menuModel.addEventListener('click', () => {
    fill(readPilot());
    showPage('model');
  });
  close.addEventListener('click', () => closeDialog(dialog));

  const persist = (): void => {
    if (!shownFields) return;
    const values = modelFields();
    const next = readPilot();
    let changed = false;
    for (const name of ['baseURL', 'model', 'apiKey'] as const) {
      if (values[name] !== shownFields[name]) {
        next[name] = values[name];
        changed = true;
      }
    }
    if (values.contextTokens !== shownFields.contextTokens) {
      next.contextTokens = numberOrNull(values.contextTokens);
      changed = true;
    }
    if (values.thinking !== shownFields.thinking) {
      next.thinking = values.thinking;
      changed = true;
    }
    if (!changed) return;
    writePilot(next);
    shownFields = values;
    paint();
  };

  settingsForm.addEventListener('input', persist);
  settingsForm.addEventListener('change', persist);
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    persist();
  });
  dialog.addEventListener('close', () => {
    open.setAttribute('aria-expanded', 'false');
    persist();
  });

  let journal: Journal | null = null;
  let lastActivity = Date.now();
  let digesting = false;
  /** When a failed digest may be tried again. */
  let digestRetryAt = 0;
  const journalReady = Promise.resolve(injected ?? openJournal())
    .then((opened) => {
      if (!opened) return null;
      journal = opened.journal;
      void opened.journal.backfill(readPilot()).catch(() => undefined);
      return opened.journal;
    })
    .catch(() => null);

  const getJournal = (): Journal | null => journal;

  const noteActivity = (): void => {
    lastActivity = Date.now();
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) {
    window.addEventListener(type, noteActivity, { passive: true });
  }

  /** Write the day into the diary once the page has been quiet long enough. */
  const rememberIfIdle = (): void => {
    if (current || digesting) return;
    const settings = readPilot();
    const opened = journal;
    if (!settings.autoMemory) return;
    if (!opened?.behind()) return;
    if (Date.now() - lastActivity < AUTO_MEMORY_IDLE_MS) return;
    if (Date.now() < digestRetryAt) return;
    digesting = true;
    void opened
      .digest(settings)
      .catch(() => {
        digestRetryAt = Date.now() + AUTO_MEMORY_IDLE_MS;
      })
      .finally(() => {
        digesting = false;
      });
  };

  window.setInterval(rememberIfIdle, AUTO_MEMORY_CHECK_MS);

  bindMemory({
    menuMemory,
    memoryForm,
    memoryEmpty,
    dateSelect,
    lineInput,
    notedInput,
    summaryInput,
    autoMemoryInput,
    showPage: () => showPage('memory'),
    getJournal,
    journalReady,
  });

  const usage = bindUsage({
    doc,
    menuUsage,
    usagePanel,
    showPage: () => showPage('usage'),
    getJournal,
    journalReady,
  });

  bindLeave({
    leave,
    leaveClose,
    leaveSummarize,
    getJournal,
    show,
  });

  const release = (controller: AbortController): void => {
    if (replaced.has(controller)) return;
    setPending(null);
    flushWorld('poke');
  };

  const run = async (
    controller: AbortController,
    text: string,
    settings: PilotSettings,
  ): Promise<void> => {
    let sawText = false;
    const traces: Trace[] = [];
    let pending: { name: string; input: unknown } | null = null;
    lastActivity = Date.now();
    setPending({ text, tool: null });
    flushWorld('poke');
    try {
      const opened = journal ?? (await journalReady);
      if (controller.signal.aborted) {
        if (!replaced.has(controller)) show('已停止', 'note');
        release(controller);
        return;
      }
      const { runAgent } = await import('./agent/loop.js');
      const reply = await runAgent({
        goal: text,
        session,
        settings,
        chat: opened?.session,
        memoryIndex: opened ? await opened.indexBlock() : undefined,
        memory: opened?.api(),
        signal: controller.signal,
        onEvent(event) {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case 'text':
              sawText = true;
              say(event.text);
              break;
            case 'tool-call':
              pending = { name: event.name, input: event.input };
              setPending({ text, tool: event.name });
              flushSoon('poke');
              show(thoughtOf(event.input), 'thought');
              break;
            case 'tool-result':
              traces.push({
                name: event.name,
                input: pending?.name === event.name ? pending.input : null,
                output: event.output,
              });
              pending = null;
              flushSoon('poke');
              break;
            case 'error':
              show(explain(event.message), 'note');
              break;
            default:
              break;
          }
        },
      });
      const answer = reply.text;
      if (reply.calls && reply.calls.length > 0) {
        await opened?.recordUsageCalls(reply.calls);
      } else {
        await opened?.recordUsage(reply.usage);
      }
      if (controller.signal.aborted) {
        if (!replaced.has(controller)) show('已停止', 'note');
        release(controller);
      } else {
        let recorded = !opened;
        let failed = false;
        if (opened) {
          try {
            await opened.record(text, answer, traces, settings);
            recorded = true;
          } catch (error) {
            failed = true;
            show(explain(error instanceof Error ? error.message : String(error)), 'note');
          }
        }
        if (recorded) release(controller);
        if (!failed && !sawText && answer.trim()) show(answer.trim(), 'speech');
      }
      if (dialog.open && !usagePanel.hidden) await usage.refresh();
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) {
        if (!replaced.has(controller)) show('已停止', 'note');
        release(controller);
      } else show(explain(error instanceof Error ? error.message : String(error)), 'note');
    } finally {
      if (current === controller) {
        current = null;
        send.textContent = '发送';
      }
      lastActivity = Date.now();
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
      showPage('model');
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
    const tailNode = doc.querySelector<HTMLElement>('#trace-tail')!;
    if (!point || trace.childElementCount === 0) {
      trace.hidden = true;
      tailNode.hidden = true;
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
    placeTail(tailNode, top, height, left + tailX, tail === 'down');
  });

  paint();
}
