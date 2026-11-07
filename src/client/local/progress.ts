import type { InitProgressReport } from '@mlc-ai/web-llm';
import type { LocalStatus } from './types.js';

/** Progress is per stage: downloading, copying cached weights, then compiling shaders. */
export function localProgress(report: InitProgressReport): LocalStatus {
  let text = '正在准备本机模型';
  if (report.text.startsWith('Fetching param cache')) text = '正在下载模型';
  else if (report.text.startsWith('Loading model from cache')) text = '正在读取本地缓存';
  else if (report.text.startsWith('Loading GPU shader modules')) text = '正在准备图形计算';
  else return { ready: false, text };

  const progress = Math.max(0, Math.min(1, report.progress));
  const elapsed = Math.max(0, Math.round(report.timeElapsed));
  let detail = `本阶段已用 ${elapsed} 秒`;
  if (text === '正在下载模型' && elapsed >= 3 && progress > 0 && progress < 1) {
    const remaining = Math.ceil((elapsed * (1 - progress)) / progress);
    detail += `，预计还需约 ${remaining} 秒（按当前速度估算）`;
  }
  return { ready: false, text, progress, detail };
}
