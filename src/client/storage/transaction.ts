/** Abort on synchronous failures too: IndexedDB otherwise may commit earlier writes. */
export async function transact<T>(
  tx: { done: Promise<unknown>; abort(): void },
  run: () => Promise<T>,
): Promise<T> {
  void tx.done.catch(() => undefined);
  try {
    const result = await run();
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => undefined);
    throw error;
  }
}
