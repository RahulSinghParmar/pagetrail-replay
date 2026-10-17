// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
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
  } = {},
): Promise<void> {
  const url = (options.makeUrl || URL.createObjectURL)(blob);
  let release = true;
  try {
    const id = await api.download({
      url,
      filename,
      saveAs: true,
      conflictAction: "uniquify",
    });
    for (let i = 0; i < (options.attempts ?? 1200); i++) {
      const item = (await api.search({ id }))[0];
      if (item?.state === "complete") return;
      if (!item || item.state === "interrupted")
        throw new Error(
          "Download canceled or interrupted" +
            (item?.error ? ": " + item.error : "") +
            ". Your saved archive is unchanged; retry export.",
        );
      await (
        options.wait ||
        (() => new Promise((resolve) => setTimeout(resolve, 250)))
      )();
    }
    release = false; // Do not invalidate a still-pending download.
    throw new Error(
      "Download is still pending. Keep this library tab open and check Edge Downloads; completion is not confirmed.",
    );
  } finally {
    if (release) (options.revoke || URL.revokeObjectURL)(url);
  }
}
export async function saveLocalFile(
  blob: Blob,
  filename: string,
): Promise<"complete" | "requested"> {
  if (typeof chrome !== "undefined" && chrome.downloads) {
    await confirmedDownload(blob, filename, chrome.downloads as DownloadApi);
    return "complete";
  }
  // Standard-browser fallback used by the synthetic browser test, not confirmation.
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "requested";
}
