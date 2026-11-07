import { localBackend } from './backend.js';
import { prepareOffline } from './offline.js';

/** Remembers that the local model loaded successfully, so a reload can load it from cache. */
const LOADED_KEY = 'spider.localLoaded';

function rememberLoaded(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOADED_KEY, '1');
    else localStorage.removeItem(LOADED_KEY);
  } catch {
    // Storage may be unavailable; the model then simply is not auto-loaded.
  }
}

export interface LocalPanel {
  /** Shows or hides the local model controls for the current mode. */
  show(local: boolean): void;
  /** Whether a previous session loaded the local model successfully. */
  wasLoaded(): boolean;
  /** Loads the local model; resolves true on success and shows the reason on failure. */
  load(): Promise<boolean>;
}

export function bindLocalPanel(doc: Document, onReady?: (ready: boolean) => void): LocalPanel {
  const panel = doc.querySelector<HTMLElement>('#local-model-panel')!;
  const load = doc.querySelector<HTMLButtonElement>('#local-load')!;
  const unload = doc.querySelector<HTMLButtonElement>('#local-unload')!;
  const status = doc.querySelector<HTMLElement>('#local-status')!;
  const offline = doc.querySelector<HTMLElement>('#offline-status')!;
  const progress = doc.querySelector<HTMLProgressElement>('#local-progress')!;
  const detail = doc.querySelector<HTMLElement>('#local-progress-detail')!;
  let statusVersion = 0;
  const report = async (version: number): Promise<void> => {
    const next = await (await localBackend()).localStatus();
    if (version !== statusVersion) return;
    onReady?.(next.ready);
    status.textContent = next.text;
    detail.textContent = next.detail ?? '';
    if (next.progress === undefined) progress.removeAttribute('value');
    else {
      progress.value = next.progress;
      status.textContent += ` · ${Math.round(next.progress * 100)}%`;
    }
  };
  const fail = (text: string): void => {
    ++statusVersion;
    onReady?.(false);
    status.textContent = text;
    progress.hidden = true;
    detail.textContent = '';
  };
  let loadAttempt = 0;
  const loadModel = (cachedOnly = false): Promise<boolean> => {
    const attempt = ++loadAttempt;
    const version = ++statusVersion;
    onReady?.(false);
    load.disabled = true;
    unload.disabled = true;
    status.textContent = '正在加载；优先使用缓存，缺失文件才会下载…';
    load.textContent = '正在加载…';
    progress.hidden = false;
    progress.removeAttribute('value');
    detail.textContent = '首次下载需要一些时间，请保持页面打开。';
    const timer = setInterval(() => {
      void report(version).catch(() => undefined);
    }, 500);
    return (async () => {
      if (!('gpu' in navigator))
        throw new Error('当前浏览器不支持 WebGPU，请使用支持 WebGPU 的桌面浏览器');
      offline.textContent = '正在准备网页离线缓存…';
      void prepareOffline().then(
        () => {
          if (attempt !== loadAttempt) return;
          offline.textContent = import.meta.env.DEV
            ? '开发模式：网页离线缓存仅在正式构建中启用'
            : '网页已缓存。模型加载成功后可断网重开；浏览器清理缓存后需要重新下载。';
        },
        () => {
          if (attempt !== loadAttempt) return;
          offline.textContent = '网页离线缓存不可用，本机模型仍可加载；暂不支持断网重开页面。';
        },
      );
      await (await localBackend()).localLoad({ cachedOnly });
      await report(++statusVersion);
      rememberLoaded(true);
      return true;
    })()
      .catch((error: unknown) => {
        fail(
          error instanceof Error && /^[\u4e00-\u9fff]/u.test(error.message)
            ? error.message
            : '模型加载失败，请检查网络、存储空间和浏览器支持后重试',
        );
        return false;
      })
      .finally(() => {
        clearInterval(timer);
        load.disabled = false;
        load.textContent = '加载本机模型';
        unload.disabled = false;
      });
  };
  load.addEventListener('click', () => void loadModel());
  // Manual loading (the button) may download; only the automatic path is cache-only.
  unload.addEventListener('click', () => {
    ++statusVersion;
    onReady?.(false);
    unload.disabled = true;
    load.disabled = true;
    void (async () => {
      await (await localBackend()).localUnload();
      rememberLoaded(false);
      await report(++statusVersion);
      progress.hidden = true;
    })()
      .catch(() => {
        fail('释放缓存失败，请稍后重试；仍无法释放时可关闭此页面');
      })
      .finally(() => {
        unload.disabled = false;
        load.disabled = false;
      });
  });
  return {
    show(local) {
      panel.hidden = !local;
      doc.querySelector<HTMLElement>('#online-model-panel')!.hidden = local;
      for (const input of doc.querySelectorAll<HTMLInputElement>(
        '#settings-form input:not([name="localModel"])',
      )) {
        input.disabled = local;
      }
    },
    wasLoaded() {
      try {
        return localStorage.getItem(LOADED_KEY) === '1';
      } catch {
        return false;
      }
    },
    load: () => loadModel(true),
  };
}
