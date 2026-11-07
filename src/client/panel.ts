import { bindLocalPanel } from './local/panel.js';
import { closeDialog, showDialog } from '../ui/dialog/index.js';
import { h } from '../ui/dom/index.js';
import { placeTail } from '../ui/dress.js';
import type { MenuSelect } from '../ui/select/index.js';
import { paint as style } from '../ui/style.js';
import { enhanceSwitch, reflectSwitch } from '../ui/switch/index.js';
import { border, color } from '../ui/token.js';
import { openJournal, type Journal, type OpenedJournal } from './journal/api.js';
import { flushSoon, flushWorld, onRestore, setPending, type BootNote } from './worldStore.js';
import type { Trace } from './journal/session.js';
import { cloudHolds } from './cloud/sync.js';
import { bindCloud } from './panel/cloud.js';
import { bindLeave } from './panel/leave.js';
import { bindMemory } from './panel/memory.js';
import { bindUsage } from './panel/usage.js';
import { explain, isAbort, numberOrNull, thoughtOf } from './panel/helpers.js';
import { QUICK_PROVIDERS, discoverModels, type ModelProvider } from './providers.js';
import { pilotReady, readPilot, writePilot, type PilotSettings } from './settings.js';
import type { Stage } from './stage.js';
import type { SimSession } from '../shared/sim/session.js';

const BUBBLE_MS = 5000;
export const AUTO_MEMORY_IDLE_MS = 30 * 60 * 1000;
const AUTO_MEMORY_CHECK_MS = 60 * 1000;

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
  const menuCloud = doc.querySelector<HTMLButtonElement>('#menu-cloud');
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
  const cloudPanel = doc.querySelector<HTMLElement>('#panel-cloud');
  const cloudForm = doc.querySelector<HTMLFormElement>('#cloud-form');
  const cloudStatus = doc.querySelector<HTMLElement>('#cloud-status');
  const cloudHold = doc.querySelector<HTMLElement>('#cloud-hold');
  const cloudTakeover = doc.querySelector<HTMLButtonElement>('#cloud-takeover');
  const cloudChoice = doc.querySelector<HTMLDialogElement>('#cloud-choice');
  const cloudUseLocal = doc.querySelector<HTMLButtonElement>('#cloud-use-local');
  const cloudUseRemote = doc.querySelector<HTMLButtonElement>('#cloud-use-remote');
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
    !usagePanel ||
    !menuCloud ||
    !cloudPanel ||
    !cloudForm ||
    !cloudStatus ||
    !cloudHold ||
    !cloudTakeover ||
    !cloudChoice ||
    !cloudUseLocal ||
    !cloudUseRemote
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
  const replaced = new WeakSet<AbortController>();
  let live: HTMLLIElement | null = null;
  let hideAt = 0;

  let touched = false;
  goal.addEventListener('input', () => {
    touched = true;
  });

  let localReady = false;
  const paint = (): void => {
    const settings = readPilot();
    const local = settings.mode === 'local';
    const ready = local ? localReady : pilotReady(settings);
    model.textContent = ready ? (local ? 'Qwen3 · 本机' : settings.model) : '';
    model.style.display = ready ? '' : 'none';
    goal.placeholder = ready
      ? '让它去做一件事'
      : local
        ? '本机模型未就绪，发送后打开加载面板'
        : '未填写模型';
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
    live.textContent = `${live.textContent ?? ''}${chunk}`;
    touch();
    stage.voice();
  };

  const localPanel = bindLocalPanel(doc, (ready) => {
    localReady = ready;
    paint();
  });

  const field = (name: string): HTMLInputElement => {
    const element = settingsForm.elements.namedItem(name);
    if (!(element instanceof HTMLInputElement)) throw new Error(`Missing settings field ${name}`);
    return element;
  };

  const providerCards = [...settingsForm.querySelectorAll<HTMLButtonElement>('[data-provider]')];
  const quickStatus = doc.querySelector<HTMLElement>('#quick-status')!;
  const quickModels = doc.querySelector<HTMLElement>('#quick-models')!;

  const modelFields = (): {
    baseURL: string;
    model: string;
    apiKey: string;
    contextTokens: string;
    thinking: boolean;
    localModel: boolean;
  } => ({
    baseURL: field('baseURL').value,
    model: field('model').value,
    apiKey: field('apiKey').value,
    contextTokens: field('contextTokens').value,
    thinking: field('thinking').checked,
    localModel: field('localModel').checked,
  });
  let shownFields: ReturnType<typeof modelFields> | null = null;

  const paintQuickProviders = (id: string): void => {
    for (const card of providerCards) {
      const on = card.dataset.provider === id;
      card.setAttribute('aria-pressed', String(on));
      card.style.border = on ? border.ink : border.hairline;
      card.style.background = on ? color.paperDeep : color.paper;
    }
  };

  const fill = (settings: PilotSettings): void => {
    field('localModel').checked = settings.mode === 'local';
    reflectSwitch(field('localModel'));
    localPanel(settings.mode === 'local');
    field('baseURL').value = settings.baseURL;
    field('model').value = settings.model;
    field('apiKey').value = settings.apiKey;
    field('contextTokens').value =
      settings.contextTokens == null ? '' : String(settings.contextTokens);
    field('thinking').checked = settings.thinking;
    reflectSwitch(field('thinking'));
    paintQuickProviders(settings.provider);
    shownFields = modelFields();
  };

  const paintQuickModels = (): void => {
    const active = field('model').value.trim();
    for (const chip of quickModels.querySelectorAll<HTMLButtonElement>('[data-quick-model]')) {
      const on = chip.dataset.quickModel === active;
      chip.setAttribute('aria-pressed', String(on));
      chip.style.border = on ? border.ink : border.hairline;
      chip.style.background = on ? color.ink : color.paper;
      chip.style.color = on ? color.paper : color.ink;
    }
  };

  const modelChip = (id: string): HTMLButtonElement => {
    const chip = h(doc, 'button', { type: 'button', 'data-quick-model': id }, id);
    style(chip, {
      border: border.hairline,
      padding: '4px 9px',
      background: color.paper,
      color: color.ink,
      font: 'inherit',
      letterSpacing: 'inherit',
      cursor: 'pointer',
    });
    chip.addEventListener('click', () => {
      field('model').value = id;
      persist();
      paintQuickModels();
    });
    return chip;
  };

  let discoverRun = 0;
  const loadQuickModels = async (provider: ModelProvider): Promise<void> => {
    const runId = ++discoverRun;
    quickStatus.textContent = '正在读取本机模型…';
    quickModels.replaceChildren();
    try {
      const found = await discoverModels(provider.baseURL, '');
      if (runId !== discoverRun) return;
      quickModels.replaceChildren(...found.map(modelChip));
      paintQuickModels();
      quickStatus.textContent =
        found.length === 0
          ? '连上了，但还没有模型。先在终端运行 ollama pull <模型名>。'
          : `找到 ${found.length} 个模型，点一个填进 Model ID。`;
    } catch {
      if (runId !== discoverRun) return;
      quickStatus.textContent = `没连上 ${provider.name}。确认它已经运行，并允许这个页面访问。`;
    }
  };

  const quickImport = (provider: ModelProvider): void => {
    const saved = readPilot();
    writePilot({
      ...saved,
      provider: provider.id,
      baseURL: provider.baseURL,
      model: saved.provider === provider.id ? saved.model : provider.model,
    });
    fill(readPilot());
    paint();
    quickModels.replaceChildren();
    if (!provider.discover) {
      quickStatus.textContent = '地址和模型已经填好，补上或确认 API Key 就能用。';
      field('apiKey').focus();
      return;
    }
    void loadQuickModels(provider);
  };

  for (const provider of QUICK_PROVIDERS) {
    settingsForm
      .querySelector<HTMLButtonElement>(`[data-provider="${provider.id}"]`)!
      .addEventListener('click', () => quickImport(provider));
  }

  const pages = {
    model: panelModel,
    memory: memoryPanel,
    usage: usagePanel,
    cloud: cloudPanel,
  } as const;
  const nav = {
    model: menuModel,
    memory: menuMemory,
    usage: menuUsage,
    cloud: menuCloud,
  } as const;

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
        if (name === 'baseURL') {
          next.provider = 'custom';
          quickModels.replaceChildren();
          quickStatus.textContent = '';
        }
        changed = true;
      }
    }
    if (values.contextTokens !== shownFields.contextTokens) {
      next.contextTokens = numberOrNull(values.contextTokens);
      changed = true;
    }
    if (values.localModel !== shownFields.localModel) {
      next.mode = values.localModel ? 'local' : 'api';
      localPanel(values.localModel);
      changed = true;
    }
    if (values.thinking !== shownFields.thinking) {
      next.thinking = values.thinking;
      changed = true;
    }
    if (!changed) return;
    writePilot(next);
    shownFields = values;
    paintQuickProviders(next.provider);
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

  bindCloud({
    menu: menuCloud,
    form: cloudForm,
    status: cloudStatus,
    hold: cloudHold,
    takeover: cloudTakeover,
    choice: cloudChoice,
    useLocal: cloudUseLocal,
    useRemote: cloudUseRemote,
    showPage: () => showPage('cloud'),
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

    if (cloudHolds()) {
      show('另一台电脑正在玩', 'note');
      return;
    }
    const settings = readPilot();
    if (settings.mode === 'local' && !localReady) {
      fill(settings);
      showPage('model');
      return;
    }
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
  if (readPilot().mode === 'local') {
    fill(readPilot());
    showPage('model');
  }
}
