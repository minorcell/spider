import { expect, it } from 'vitest';
import { localProgress } from '../../../src/client/local/progress.js';

it('translates download progress and estimates only the current download stage', () => {
  expect(
    localProgress({
      text: 'Fetching param cache[3/9]: 93MB fetched.',
      progress: 0.25,
      timeElapsed: 10,
    }),
  ).toEqual({
    ready: false,
    text: '正在下载模型',
    progress: 0.25,
    detail: '本阶段已用 10 秒，预计还需约 30 秒（按当前速度估算）',
  });
});

it.each([
  ['Loading model from cache[1/9]', '正在读取本地缓存'],
  ['Loading GPU shader modules[3/8]', '正在准备图形计算'],
])('labels %s as a separate stage without a download estimate', (text, label) => {
  expect(localProgress({ text, progress: 0.5, timeElapsed: 10 })).toEqual({
    ready: false,
    text: label,
    progress: 0.5,
    detail: '本阶段已用 10 秒',
  });
});

it.each([
  [0, 5],
  [0.1, 1],
  [1, 10],
  [-0.1, -1],
  [1.1, 10],
])(
  'does not invent a remaining duration at progress %s and elapsed %s',
  (progress, timeElapsed) => {
    const status = localProgress({ text: 'Fetching param cache', progress, timeElapsed });
    expect(status.detail).not.toContain('预计');
    expect(status.progress).toBeGreaterThanOrEqual(0);
    expect(status.progress).toBeLessThanOrEqual(1);
  },
);

it.each(['Start to fetch params', 'Finish loading on GPU', 'Unknown engine message'])(
  'keeps %s indeterminate until the engine is ready',
  (text) => {
    expect(localProgress({ text, progress: 1, timeElapsed: 10 })).toEqual({
      ready: false,
      text: '正在准备本机模型',
    });
  },
);
