// SPDX-License-Identifier: AGPL-3.0-or-later
// Tracks asynchronous body reads and commits, including native fire-and-forget calls.
export class CaptureWork {
  private readonly tasks = new Set<Promise<unknown>>();
  get size() {
    return this.tasks.size;
  }
  track<T>(task: Promise<T>): Promise<T> {
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task)).catch(() => {});
    return task;
  }
  async idle() {
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
  }
}

export async function waitForQuiet(
  pending: () => number,
  options: { timeoutMs?: number; quietMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const started = performance.now();
  let quietSince = started;
  while (performance.now() - started < (options.timeoutMs ?? 10000)) {
    if (pending()) quietSince = performance.now();
    else if (performance.now() - quietSince >= (options.quietMs ?? 500))
      return true;
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 50));
  }
  return false;
}
