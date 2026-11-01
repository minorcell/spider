import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSound } from '../../src/client/sound.js';
import { AudioContextStub } from '../stubs.js';

let target: EventTarget;

beforeEach(() => {
  target = new EventTarget();
});

afterEach(() => {
  vi.useRealTimers();
});

function unlockedSound(): { sound: ReturnType<typeof createSound>; ctx: AudioContextStub } {
  const sound = createSound(target);
  target.dispatchEvent(new Event('pointerdown'));
  const ctx = AudioContextStub.last!;
  return { sound, ctx };
}

describe('createSound', () => {
  it('stays silent until a gesture opens the context', () => {
    const sound = createSound(target);
    sound.step(1);
    sound.voice();
    sound.bite();
    expect(AudioContextStub.last).toBeNull();
    void sound;
  });

  it('opens the context on a pointer or a key', () => {
    const sound = createSound(target);
    target.dispatchEvent(new Event('pointerdown'));
    const ctx = AudioContextStub.last!;
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('keydown'));
    expect(AudioContextStub.last).toBe(ctx);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    sound.dispose();
  });

  it('plays every click with the context running', () => {
    vi.useFakeTimers();
    const { sound, ctx } = unlockedSound();
    ctx.state = 'running';
    sound.step(8);
    sound.step(0);
    sound.bite();
    vi.advanceTimersByTime(60);
    sound.take();
    vi.advanceTimersByTime(70);
    sound.grasp();
    sound.place();
    sound.knock();
    sound.voice();
    expect(ctx.oscillators.length).toBeGreaterThan(5);
    expect(ctx.sources.length).toBeGreaterThan(0);
  });

  it('reuses the noise buffer at the same sample rate and rebuilds at another', () => {
    const { sound, ctx } = unlockedSound();
    ctx.state = 'running';
    sound.grasp();
    sound.grasp();
    expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
    ctx.sampleRate = 4000;
    sound.grasp();
    expect(ctx.createBuffer).toHaveBeenCalledTimes(2);
    expect(ctx.buffers[1].sampleRate).toBe(4000);
  });

  it('returns early when the context is not running', () => {
    const { sound, ctx } = unlockedSound();
    ctx.state = 'suspended';
    sound.grasp();
    expect(ctx.createGain).not.toHaveBeenCalled();
    ctx.state = 'running';
    sound.voice();
    expect(ctx.currentTime).toBe(0);
  });

  it('shares one voice tick across a fast stream', () => {
    const { sound, ctx } = unlockedSound();
    ctx.state = 'running';
    ctx.currentTime = 0;
    sound.voice();
    const afterFirst = ctx.oscillators.length;
    ctx.currentTime = 0.05;
    sound.voice();
    expect(ctx.oscillators.length).toBe(afterFirst);
    ctx.currentTime = 0.08;
    sound.voice();
    expect(ctx.oscillators.length).toBe(afterFirst + 1);
  });

  it('skips the scrape when grit is zero', () => {
    const { sound, ctx } = unlockedSound();
    ctx.state = 'running';
    sound.voice();
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
  });

  it('closes the context and unhooks its listeners', () => {
    const { sound, ctx } = unlockedSound();
    sound.dispose();
    expect(ctx.close).toHaveBeenCalled();
    target.dispatchEvent(new Event('pointerdown'));
    expect(AudioContextStub.last).toBe(ctx);
  });
});
