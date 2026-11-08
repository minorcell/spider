/** Show the first words immediately, then append at most once per animation frame. */
export function streamSpeech(append: (text: string) => void) {
  let started = false;
  let closed = false;
  let frame: number | undefined;
  let pending: string[] = [];

  const flush = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    if (!pending.length) return;
    const text = pending.join('');
    pending = [];
    append(text);
  };

  return {
    write(text: string): void {
      if (closed || !text) return;
      if (!started) {
        started = true;
        append(text);
        return;
      }
      pending.push(text);
      frame ??= requestAnimationFrame(flush);
    },
    flush,
    finish(): void {
      flush();
      closed = true;
    },
    cancel(): void {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      pending = [];
      closed = true;
    },
  };
}
