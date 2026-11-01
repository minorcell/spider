import { Diary } from './journal/diary.js';
import { localDate } from './journal/dates.js';
import type { Trace } from './journal/session.js';
import { formatTokens, readUsage, recordUsage, type UsageSnapshot } from './journal/usage.js';
import { pilotReady, readPilot, writePilot, type PilotSettings } from './settings.js';
import type { Stage } from './stage.js';
import type { SimSession } from '../shared/sim/session.js';

const BUBBLE_MS = 5000;
/** How long the page must go untouched before auto memory may run. */
export const AUTO_MEMORY_IDLE_MS = 30 * 60 * 1000;
/** How often to check whether that idle stretch has passed. */
const AUTO_MEMORY_CHECK_MS = 60 * 1000;

/** Settings, the instruction box, and the bubble that follows the spider. */
export function mountPanel(doc: Document, session: SimSession, stage: Stage): void {
  const form = doc.querySelector<HTMLFormElement>('#pilot');
  const goal = doc.querySelector<HTMLInputElement>('#goal');
  const send = doc.querySelector<HTMLButtonElement>('#pilot-send');
  const model = doc.querySelector<HTMLElement>('#pilot-model');
  const trace = doc.querySelector<HTMLOListElement>('#trace');
  const open = doc.querySelector<HTMLButtonElement>('#settings-open');
  const menu = doc.querySelector<HTMLElement>('#corner-menu');
  const menuModel = doc.querySelector<HTMLButtonElement>('#menu-model');
  const menuMemory = doc.querySelector<HTMLButtonElement>('#menu-memory');
  const menuUsage = doc.querySelector<HTMLButtonElement>('#menu-usage');
  const map = doc.querySelector<HTMLButtonElement>('#observe-open');
  const lookHint = doc.querySelector<HTMLElement>('#look-hint');
  const dialog = doc.querySelector<HTMLDialogElement>('#settings');
  const settingsForm = doc.querySelector<HTMLFormElement>('#settings-form');
  const close = doc.querySelector<HTMLButtonElement>('#settings-close');
  const memoryDialog = doc.querySelector<HTMLDialogElement>('#memory');
  const memoryForm = doc.querySelector<HTMLFormElement>('#memory-form');
  const memoryClose = doc.querySelector<HTMLButtonElement>('#memory-close');
  const memoryEmpty = doc.querySelector<HTMLElement>('#memory-empty');
  const leave = doc.querySelector<HTMLDialogElement>('#leave');
  const leaveClose = doc.querySelector<HTMLButtonElement>('#leave-close');
  const leaveSummarize = doc.querySelector<HTMLButtonElement>('#leave-summarize');
  const usageDialog = doc.querySelector<HTMLDialogElement>('#usage');
  const usageClose = doc.querySelector<HTMLButtonElement>('#usage-close');
  const usageToday = doc.querySelector<HTMLElement>('#usage-today');
  const usageTotal = doc.querySelector<HTMLElement>('#usage-total');
  const usageDays = doc.querySelector<HTMLOListElement>('#usage-days');
  const usageEmpty = doc.querySelector<HTMLElement>('#usage-empty');
  if (
    !form ||
    !goal ||
    !send ||
    !model ||
    !trace ||
    !open ||
    !menu ||
    !menuModel ||
    !menuMemory ||
    !menuUsage ||
    !map ||
    !dialog ||
    !settingsForm ||
    !close ||
    !memoryDialog ||
    !memoryForm ||
    !memoryClose ||
    !memoryEmpty ||
    !leave ||
    !leaveClose ||
    !leaveSummarize ||
    !usageDialog ||
    !usageClose ||
    !usageToday ||
    !usageTotal ||
    !usageDays ||
    !usageEmpty
  ) {
    throw new Error('Missing pilot chrome');
  }

  const dateSelect = memoryForm.querySelector<HTMLSelectElement>('select[name="date"]');
  const lineInput = memoryForm.querySelector<HTMLInputElement>('input[name="line"]');
  const notedInput = memoryForm.querySelector<HTMLTextAreaElement>('textarea[name="noted"]');
  const summaryInput = memoryForm.querySelector<HTMLTextAreaElement>('textarea[name="summary"]');
  const autoMemoryInput = memoryForm.querySelector<HTMLInputElement>('input[name="autoMemory"]');
  if (!dateSelect || !lineInput || !notedInput || !summaryInput || !autoMemoryInput) {
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
    field('contextTokens').value =
      settings.contextTokens == null ? '' : String(settings.contextTokens);
    field('compact').checked = settings.compact;
    field('compactKb').value = settings.compactKb == null ? '' : String(settings.compactKb);
  };

  const setMenu = (shown: boolean): void => {
    menu.hidden = !shown;
    open.setAttribute('aria-expanded', shown ? 'true' : 'false');
  };

  open.addEventListener('click', () => setMenu(menu.hasAttribute('hidden')));
  menuModel.addEventListener('click', () => {
    setMenu(false);
    fill(readPilot());
    dialog.showModal();
  });
  doc.addEventListener('click', (event) => {
    /* v8 ignore next */
    if (!(event.target instanceof Node)) return;
    if (open.contains(event.target) || menu.contains(event.target)) return;
    setMenu(false);
  });
  close.addEventListener('click', () => dialog.close());

  const persist = (): void => {
    writePilot({
      baseURL: field('baseURL').value,
      model: field('model').value,
      apiKey: field('apiKey').value,
      contextTokens: numberOrNull(field('contextTokens').value),
      compact: field('compact').checked,
      compactKb: numberOrNull(field('compactKb').value),
    });
    paint();
  };

  settingsForm.addEventListener('input', persist);
  settingsForm.addEventListener('submit', persist);
  dialog.addEventListener('close', persist);

  let diary: Diary | null = null;
  let lastActivity = Date.now();
  let digesting = false;
  /** When a failed digest may be tried again. */
  let digestRetryAt = 0;
  const diaryReady = Diary.open()
    .then((opened) => {
      diary = opened;
      void opened.backfill(readPilot()).catch(() => undefined);
      return opened;
    })
    .catch(() => null);

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
    const opened = diary;
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

  const fillMemory = (page: { line: string; noted: string; summary: string }): void => {
    lineInput.value = page.line;
    notedInput.value = page.noted;
    summaryInput.value = page.summary;
  };

  const showMemory = async (): Promise<void> => {
    const opened = diary ?? (await diaryReady);
    /* v8 ignore next */
    if (!opened) return;
    const pages = await opened.pages();
    dateSelect.replaceChildren();
    memoryEmpty.hidden = pages.length > 0;
    for (const page of pages) {
      const option = doc.createElement('option');
      option.value = page.date;
      option.textContent = page.description ? `${page.date} ${page.description}` : page.date;
      dateSelect.append(option);
    }
    const latest = pages[pages.length - 1];
    if (latest) {
      dateSelect.value = latest.date;
      fillMemory({ line: latest.description, noted: latest.noted, summary: latest.summary });
    } else {
      lineInput.value = '';
      notedInput.value = '';
      summaryInput.value = '';
    }
    setMenu(false);
    autoMemoryInput.checked = readPilot().autoMemory;
    memoryDialog.showModal();
  };

  menuMemory.addEventListener('click', () => {
    void showMemory();
  });

  const renderUsage = (snapshot: UsageSnapshot): void => {
    usageToday.textContent = usageFigure(snapshot.today);
    usageTotal.textContent = usageFigure(snapshot.sum);
    usageDays.replaceChildren();
    for (const day of snapshot.days) {
      const item = doc.createElement('li');
      item.textContent = `${day.date}　${formatTokens(day.total)}`;
      usageDays.append(item);
    }
    usageEmpty.hidden = snapshot.days.length > 0;
  };

  const refreshUsage = async (): Promise<void> => {
    const today = localDate(new Date());
    try {
      renderUsage(await readUsage(today));
    } catch {
      renderUsage({
        today: { date: today, input: 0, output: 0, total: 0, calls: 0, cacheRead: 0, reasoning: 0 },
        sum: { date: '', input: 0, output: 0, total: 0, calls: 0, cacheRead: 0, reasoning: 0 },
        days: [],
      });
    }
  };

  menuUsage.addEventListener('click', () => {
    setMenu(false);
    usageDialog.showModal();
    void refreshUsage();
  });
  usageClose.addEventListener('click', () => usageDialog.close());
  memoryClose.addEventListener('click', () => memoryDialog.close());
  autoMemoryInput.addEventListener('change', () => {
    writePilot({ ...readPilot(), autoMemory: autoMemoryInput.checked });
  });
  dateSelect.addEventListener('change', () => {
    void diary?.read(dateSelect.value).then((page) => {
      if (page) fillMemory(page);
    });
  });
  memoryForm.addEventListener('submit', () => {
    if (!diary) return;
    const date = dateSelect.value || diary.date;
    void diary.write({
      date,
      line: lineInput.value,
      noted: notedInput.value,
      summary: summaryInput.value,
    });
  });

  leaveClose.addEventListener('click', () => {
    if (diary) diary.dismissed = true;
    leave.close();
  });
  leaveSummarize.addEventListener('click', () => {
    if (!diary) return;
    leaveSummarize.disabled = true;
    void diary
      .digest(readPilot())
      .then(() => {
        show('记下了。这个页面可以关掉了。', 'note');
        leave.close();
      })
      .catch((error: unknown) => {
        show(explain(error instanceof Error ? error.message : String(error)), 'note');
      })
      .finally(() => {
        leaveSummarize.disabled = false;
      });
  });

  window.addEventListener('beforeunload', (event) => {
    // Vite reloads this page on each save. That is not the user leaving.
    if (import.meta.env.MODE === 'development') return;
    if (!diary?.behind()) return;
    event.preventDefault();
    window.setTimeout(() => {
      if (!leave.open) leave.showModal();
    }, 0);
  });
  window.addEventListener('pagehide', () => {
    void diary?.save();
  });

  const run = async (
    controller: AbortController,
    text: string,
    settings: PilotSettings,
  ): Promise<void> => {
    let sawText = false;
    const traces: Trace[] = [];
    let pending: { name: string; input: unknown } | null = null;
    try {
      const opened = diary ?? (await diaryReady);
      if (controller.signal.aborted) {
        if (!replaced.has(controller)) show('已停止', 'note');
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
              show(thoughtOf(event.input), 'thought');
              break;
            case 'tool-result':
              traces.push({
                name: event.name,
                input: pending?.name === event.name ? pending.input : null,
                output: event.output,
              });
              pending = null;
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
      await recordUsage(reply.usage);
      if (opened && !controller.signal.aborted) {
        try {
          await opened.record(text, answer, traces, settings);
        } catch (error) {
          show(explain(error instanceof Error ? error.message : String(error)), 'note');
        }
      }
      if (usageDialog.open) await refreshUsage();
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

function usageFigure(row: { input: number; output: number; total: number; calls: number }): string {
  return [
    `输入 ${formatTokens(row.input)}`,
    `输出 ${formatTokens(row.output)}`,
    `合计 ${formatTokens(row.total)}`,
    `${row.calls} 次`,
  ].join('\n');
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
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
