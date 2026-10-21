// SPDX-License-Identifier: AGPL-3.0-or-later
export class OperationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OperationError";
  }
}
export function canceled(): OperationError {
  return new OperationError(
    "CANCELED",
    "Export canceled. Your recording is unchanged.",
  );
}
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw canceled();
}
export async function bounded<T>(
  task: Promise<T>,
  options: {
    signal?: AbortSignal;
    ms?: number;
    code?: string;
    message?: string;
  } = {},
): Promise<T> {
  if (options.signal?.aborted) {
    void task.catch(() => {});
    throw canceled();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        abort = () => reject(canceled());
        options.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(
          () =>
            reject(
              new OperationError(
                options.code || "TIMEOUT",
                options.message ||
                  "This operation did not respond. Your recording is unchanged; retry or export a diagnostic report.",
              ),
            ),
          options.ms ?? 10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
  }
}
export function safeErrorCode(error: unknown): string {
  if (error instanceof OperationError) return error.code;
  const name = error instanceof Error ? error.name : "";
  if (
    [
      "QuotaExceededError",
      "VersionError",
      "DataError",
      "NotFoundError",
      "SecurityError",
      "AbortError",
      "InvalidStateError",
    ].includes(name)
  )
    return name;
  return "UNEXPECTED_ERROR";
}
