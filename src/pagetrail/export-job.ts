// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  ExportFile,
  ExportProgress,
  ExportReply,
  ExportRequest,
} from "./export-protocol";
import { canceled, OperationError } from "./operations";
export type ExportWorker = {
  postMessage(value: ExportRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ExportReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
};
export function runExportJob(
  request: ExportRequest,
  options: {
    signal?: AbortSignal;
    progress?: (value: ExportProgress) => void;
    worker?: () => ExportWorker;
    idleMs?: number;
    totalMs?: number;
  } = {},
): Promise<ExportFile> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(canceled());
      return;
    }
    let worker: ExportWorker | undefined,
      idle: ReturnType<typeof setTimeout>,
      total: ReturnType<typeof setTimeout>,
      finished = false;
    function finish(error?: unknown, file?: ExportFile) {
      if (finished) return;
      finished = true;
      clearTimeout(idle);
      clearTimeout(total);
      options.signal?.removeEventListener("abort", abort);
      worker?.terminate();
      if (error) reject(error);
      else resolve(file!);
    }
    const abort = () => finish(canceled());
    const timeout = () =>
      finish(
        new OperationError(
          "EXPORT_TIMEOUT",
          "Export stopped because it stopped responding or took too long. Your recording is unchanged. Try Markdown, a smaller session, or save a diagnostic report.",
        ),
      );
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(timeout, options.idleMs ?? 30000);
    };
    try {
      worker = (
        options.worker ||
        (() =>
          new Worker(new URL("./export-worker.ts", import.meta.url), {
            name: "pagetrail-export",
          }))
      )();
      options.signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event) => {
        if (finished) return;
        const message = event.data;
        touch();
        if (message.kind === "progress") options.progress?.(message.value);
        if (message.kind === "result") finish(undefined, message.value);
        if (message.kind === "error")
          finish(
            new OperationError(message.code, exportErrorMessage(message.code)),
          );
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        finish(
          new OperationError(
            "WORKER_FAILED",
            "The background exporter could not start or crashed. Reload the extension, keep this recording, and retry. A diagnostic report can identify this stage.",
          ),
        );
      };
      worker.onmessageerror = () =>
        finish(
          new OperationError(
            "WORKER_FAILED",
            "The background export result could not be read. Your recording is unchanged; retry.",
          ),
        );
      options.progress?.({ phase: "starting" });
      touch();
      total = setTimeout(timeout, options.totalMs ?? 120000);
      worker.postMessage(request);
    } catch {
      finish(
        new OperationError(
          "WORKER_FAILED",
          "The background exporter is unavailable. Reload the same extension and retry; your recording is unchanged.",
        ),
      );
    }
  });
}
function exportErrorMessage(code: string) {
  if (code === "STORAGE_BLOCKED")
    return "Local storage is waiting on another PageTrail tab. Close other PageTrail library tabs, then retry. Do not clear storage or uninstall.";
  if (code === "NO_VISUAL_STATES")
    return "This older recording has no visual page states. Keep its WACZ or text export; a new recording is required for website-session HTML.";
  if (code === "EXPORT_TOO_LARGE")
    return "The export exceeds its size limit. Your recording is preserved. Try a text export or record a shorter session.";
  if (code === "MISSING_ASSET")
    return "A captured resource is missing. No incomplete website HTML was saved. Keep the recording and try the text export.";
  if (code === "QuotaExceededError")
    return "The browser has run out of local storage. Existing recordings are preserved. Export what is available before changing storage.";
  if (code === "VersionError")
    return "This recording uses a newer local database version. Reload the latest installed extension; do not clear its storage.";
  return "The export failed while preparing the saved content. Your recording is unchanged. Retry or save a diagnostic report for investigation.";
}
