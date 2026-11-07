let busy = false;
const listeners = new Set<(busy: boolean) => void>();

export function setLocalBusy(value: boolean): void {
  if (busy === value) return;
  busy = value;
  for (const listener of listeners) listener(busy);
}

export function onLocalBusy(listener: (busy: boolean) => void): () => void {
  listeners.add(listener);
  listener(busy);
  return () => listeners.delete(listener);
}
