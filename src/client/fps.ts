import { paintFps } from '@/src/ui/dress';

export class FpsDisplay {
  readonly element: HTMLSpanElement;
  #last: number | null = null;
  #elapsed = 0;
  #frames = 0;
  readonly #intervals: number[] = [];

  constructor(host: HTMLElement) {
    this.element = host.ownerDocument.createElement('span');
    this.element.id = 'fps';
    this.element.textContent = 'FPS —';
    this.element.title = '最近半秒的平均渲染帧率';
    paintFps(this.element);
    host.append(this.element);
  }

  tick(now: number): void {
    const previous = this.#last;
    this.#last = now;
    if (previous === null) return;
    const elapsed = now - previous;
    if (this.element.ownerDocument.hidden || elapsed <= 0 || elapsed > 1000) {
      this.#elapsed = 0;
      this.#frames = 0;
      this.#intervals.length = 0;
      this.element.textContent = 'FPS —';
      return;
    }
    this.#elapsed += elapsed;
    this.#frames += 1;
    this.#intervals.push(elapsed);
    if (this.#elapsed < 500) return;
    const text = `FPS ${Math.round((this.#frames * 1000) / this.#elapsed)}`;
    if (this.element.textContent !== text) this.element.textContent = text;
    const intervals = this.#intervals.toSorted((a, b) => a - b);
    const percentile = (p: number) =>
      intervals[Math.max(0, Math.ceil(intervals.length * p) - 1)].toFixed(1);
    this.element.title = `帧间隔 P95 ${percentile(0.95)} ms · P99 ${percentile(0.99)} ms · 长帧 ${intervals.filter((ms) => ms > 50).length}`;
    this.#intervals.length = 0;
    this.#elapsed = 0;
    this.#frames = 0;
  }
}
