// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import { bounded, checkAbort, OperationError } from "./operations";
import type { ExportProgress } from "./export-protocol";
export const EXPORT_LIMIT = 100 * 1024 * 1024;
export async function responseBlob(
  response: Response,
  progress: (bytes: number) => void = () => {},
  limit = EXPORT_LIMIT,
): Promise<Blob> {
  if (!response.ok || !response.body)
    throw new Error(
      "The local exporter did not return a file. Saved archives are unchanged.",
    );
  const reader = response.body.getReader(),
    parts: BlobPart[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new Error(
          "This export exceeds the 100 MB preview safety limit. Nothing was deleted. Try the smaller HTML/Markdown reading export.",
        );
      parts.push(value);
      progress(size);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size)
    throw new Error(
      "The local exporter produced an empty file. Saved archives are unchanged.",
    );
  return new Blob(parts, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}
export type DownloadApi = {
  cancel?: (id: number) => Promise<void>;
  download: (options: {
    url: string;
    filename: string;
    saveAs: boolean;
    conflictAction: "uniquify";
  }) => Promise<number>;
  search: (query: {
    id: number;
  }) => Promise<{ state: string; error?: string }[]>;
};
export async function confirmedDownload(
  blob: Blob,
  filename: string,
  api: DownloadApi,
  options: {
    makeUrl?: (blob: Blob) => string;
    revoke?: (url: string) => void;
    wait?: () => Promise<void>;
    attempts?: number;
    signal?: AbortSignal;
    progress?: (value: ExportProgress) => void;
    dialogMs?: number;
    downloadMs?: number;
  } = {},
): Promise<void> {
  checkAbort(options.signal);
  const url = (options.makeUrl || URL.createObjectURL)(blob);
  let release = true;
  let downloadId: number | undefined;
  try {
    options.progress?.({ phase: "save-dialog" });
    const pending = api.download({
      url,
      filename,
      saveAs: true,
      conflictAction: "uniquify",
    });
    const id = await bounded(pending, {
      signal: options.signal,
      ms: options.dialogMs ?? 60000,
      code: "SAVE_DIALOG_TIMEOUT",
      message:
        "The browser's Save dialog did not finish. Dismiss any open dialog, then use Save ready file to retry without rebuilding.",
    }).catch((error) => {
      // A browser picker cannot always be dismissed by an extension. If it resolves
      // after cancellation, cancel that late download rather than leaking a job.
      void pending.then((id) => api.cancel?.(id)).catch(() => {});
      throw error;
    });
    downloadId = id;
    const started = Date.now();
    options.progress?.({ phase: "downloading" });
    for (let i = 0; i < (options.attempts ?? 1200); i++) {
      checkAbort(options.signal);
      const item = (
        await bounded(api.search({ id }), {
          signal: options.signal,
          ms: 8000,
          code: "DOWNLOAD_TIMEOUT",
        })
      )[0];
      if (item?.state === "complete") {
        options.progress?.({ phase: "complete" });
        return;
      }
      if (!item || item.state === "interrupted")
        throw new OperationError(
          "DOWNLOAD_INTERRUPTED",
          "Download canceled or interrupted" +
            (item?.error ? ": " + item.error : "") +
            ". Your saved archive is unchanged; retry export.",
        );
      if (Date.now() - started > (options.downloadMs ?? 60000)) break;
      await (
        options.wait ||
        (() => new Promise((resolve) => setTimeout(resolve, 250)))
      )();
    }
    release = false; // Do not invalidate a still-pending download.
    throw new OperationError(
      "DOWNLOAD_TIMEOUT",
      "Download is still pending. Keep this library tab open and check Edge Downloads; completion is not confirmed.",
    );
  } catch (error) {
    if (downloadId !== undefined && options.signal?.aborted)
      await bounded(api.cancel?.(downloadId) || Promise.resolve(), {
        ms: 1000,
      }).catch(() => {});
    throw error;
  } finally {
    if (release) (options.revoke || URL.revokeObjectURL)(url);
    else
      setTimeout(
        () => (options.revoke || URL.revokeObjectURL)(url),
        300000,
      ).unref?.();
  }
}
export async function saveLocalFile(
  blob: Blob,
  filename: string,
  options: {
    signal?: AbortSignal;
    progress?: (value: ExportProgress) => void;
    dialogMs?: number;
    downloadMs?: number;
  } = {},
): Promise<"complete" | "requested"> {
  if (typeof chrome !== "undefined" && chrome.downloads) {
    await confirmedDownload(
      blob,
      filename,
      chrome.downloads as DownloadApi,
      options,
    );
    return "complete";
  }
  // Standard-browser fallback used by the synthetic browser test, not confirmation.
  checkAbort(options.signal);
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  options.progress?.({ phase: "ready" });
  return "requested";
}
