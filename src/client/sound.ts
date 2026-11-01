/** Short mechanical clicks. The context stays closed until the first gesture. */

export function createSound(target: EventTarget) {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let lastVoice = 0;

  const unlock = (): void => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  };
  target.addEventListener('pointerdown', unlock);
  target.addEventListener('keydown', unlock);

  const scrape = (audio: AudioContext): AudioBuffer => {
    if (noise && noise.sampleRate === audio.sampleRate) return noise;
    noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
  };

  /** A pitched tick with a band-passed scrape, so it reads as metal rather than a beep. */
  const click = (freq: number, duration: number, gain: number, grit: number): void => {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    amp.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), now + duration);
    osc.connect(amp);
    osc.start(now);
    osc.stop(now + duration);

    /* v8 ignore next */
    if (grit <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = scrape(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 3, now);
    filter.Q.value = 2.2;
    const gritAmp = ctx.createGain();
    gritAmp.gain.setValueAtTime(gain * grit, now);
    gritAmp.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.65);
    src.connect(filter);
    filter.connect(gritAmp);
    gritAmp.connect(ctx.destination);
    src.start(now);
    src.stop(now + duration);
  };

  return {
    /** A foot meets the ground. Faster steps sit a little higher. */
    step(speed = 0): void {
      const fast = Math.min(1, Math.abs(speed) / 4);
      click(118 + Math.random() * 28 + fast * 36, 0.038, 0.042, 0.9);
    },
    /** A bite into something that is still there. */
    bite(): void {
      click(230, 0.04, 0.046, 1);
      window.setTimeout(() => click(128, 0.05, 0.032, 0.75), 46);
    },
    /** Something was taken from the world. */
    take(): void {
      click(460, 0.05, 0.036, 0.35);
      window.setTimeout(() => click(220, 0.08, 0.028, 0.25), 58);
    },
    /** Something settled onto the back. */
    grasp(): void {
      click(340, 0.045, 0.04, 0.5);
    },
    /** Something was set on the ground. */
    place(): void {
      click(150, 0.06, 0.042, 0.85);
    },
    /** The body met a wall or a slope it will not climb. */
    knock(): void {
      click(68, 0.09, 0.05, 1.15);
    },
    /** A little tick while words appear. Fast streams share one tick. */
    voice(): void {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now - lastVoice < 0.07) return;
      lastVoice = now;
      click(680 + Math.random() * 80, 0.018, 0.016, 0.15);
    },
    dispose(): void {
      target.removeEventListener('pointerdown', unlock);
      target.removeEventListener('keydown', unlock);
      void ctx?.close();
    },
  };
}
