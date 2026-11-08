import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { streamSpeech } from '@/src/client/panel/speech';

let frames: Map<number, FrameRequestCallback>;
let sequence: number;

beforeEach(() => {
  frames = new Map();
  sequence = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++sequence, callback);
      return sequence;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
});

afterEach(() => vi.unstubAllGlobals());

it('shows the first words immediately and coalesces a burst into one frame', () => {
  const append = vi.fn();
  const speech = streamSpeech(append);
  speech.write('');
  speech.write('第一段');
  expect(append).toHaveBeenCalledExactlyOnceWith('第一段');
  for (let i = 0; i < 1000; i++) speech.write('字');
  expect(requestAnimationFrame).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledOnce();
  frames.get(1)!(16);
  expect(append).toHaveBeenLastCalledWith('字'.repeat(1000));
  speech.write('下一帧');
  expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  speech.finish();
  expect(append).toHaveBeenLastCalledWith('下一帧');
  expect(frames.size).toBe(0);
  speech.write('结束后');
  expect(append).toHaveBeenCalledTimes(3);
});

it('flushes pending text before a tool or error replaces the bubble', () => {
  const append = vi.fn();
  const speech = streamSpeech(append);
  speech.write('我');
  speech.write('看看');
  speech.flush();
  expect(append.mock.calls).toEqual([['我'], ['看看']]);
  expect(frames.size).toBe(0);
  speech.flush();
  expect(append).toHaveBeenCalledTimes(2);
});

it('discards queued text on cancellation so a replaced run cannot repaint the bubble', () => {
  const append = vi.fn();
  const speech = streamSpeech(append);
  speech.write('第一段');
  speech.write('尚未绘制');
  speech.cancel();
  speech.finish();
  speech.write('迟到的输出');
  expect(frames.size).toBe(0);
  expect(append).toHaveBeenCalledExactlyOnceWith('第一段');
});

it('can cancel or finish before receiving any output', () => {
  const append = vi.fn();
  streamSpeech(append).cancel();
  streamSpeech(append).finish();
  expect(append).not.toHaveBeenCalled();
  expect(cancelAnimationFrame).not.toHaveBeenCalled();
});
