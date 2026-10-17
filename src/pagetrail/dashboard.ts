// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import type { Session } from "./session";
import { createLocalExport, type ExportFormat } from "./export";
import { saveLocalFile } from "./download";
const $ = (id: string) => document.getElementById(id)!;
let exporting = false;
async function refresh() {
  const result: {
    error?: string;
    session: Session | null;
    archives: {
      id: string;
      title: string;
      bytes: number;
      visual?: {
        states: number;
        documents: number;
        bytes: number;
        error: string;
      };
    }[];
  } = await chrome.runtime.sendMessage({
    method: "pagetrail.replay",
    action: "status",
  });
  if (result.error) throw new Error(result.error);
  $("archives").replaceChildren();
  if (!result.archives.length)
    $("archives").textContent =
      "No archives yet. Start a session from the extension popup on a website.";
  for (const archive of result.archives) {
    const article = document.createElement("article");
    const title = document.createElement("h2");
    title.textContent = archive.title;
    const detail = document.createElement("small");
    detail.textContent =
      (archive.bytes / 1048576).toFixed(1) + " MB stored locally";
    detail.textContent += archive.visual?.states
      ? ` · ${archive.visual.states} visual states · ${
          archive.visual.documents
        } documents in latest capture · ${(
          archive.visual.bytes / 1048576
        ).toFixed(1)} MB visual storage`
      : " · Older/resource-only archive: no visual session HTML available";
    if (archive.visual?.error)
      detail.textContent += " · Capture warning: " + archive.visual.error;
    const actions = document.createElement("div");
    actions.className = "buttons";
    const unfinished =
      result.session?.id === archive.id && result.session.state !== "STOPPED";
    if (unfinished)
      detail.textContent += " · Finish this session before exporting";
    else if (!archive.bytes)
      detail.textContent +=
        " · No network resources; reading export can still use captured text";
    for (const [format, label] of [
      ["html", "Save website session (.html)"],
      ["md", "Save captured text (.md)"],
      ["reading", "Save text-only reading (.html)"],
      ["wacz", "Save replay archive (.wacz)"],
    ] as const) {
      const download = document.createElement("button");
      download.className = format === "html" ? "primary" : "";
      download.textContent = label;
      download.dataset.export = format;
      download.disabled =
        exporting ||
        Boolean(unfinished) ||
        (format === "html" && !archive.visual?.states) ||
        (format === "wacz" && !archive.bytes);
      download.addEventListener("click", () => {
        if (exporting) return;
        exporting = true;
        for (const button of document.querySelectorAll<HTMLButtonElement>(
          "button[data-export]",
        ))
          button.disabled = true;
        $("error").textContent = "";
        void (async () => {
          const latest = await chrome.runtime.sendMessage({
            method: "pagetrail.replay",
            action: "status",
          });
          if (
            latest.error ||
            (latest.session?.id === archive.id &&
              latest.session.state !== "STOPPED")
          )
            throw new Error("Finish this session before exporting.");
          $("notice").textContent =
            "Preparing a local file. Keep this library tab open…";
          const file = await createLocalExport(
            archive.id,
            format as ExportFormat,
            (text) => {
              $("notice").textContent = text;
            },
          );
          const result = await saveLocalFile(file.blob, file.filename);
          $("notice").textContent =
            (result === "complete" ? "Saved " : "Download requested: ") +
            file.filename +
            (file.missing
              ? ` · Coverage warning: ${file.missing} entries had no readable text; see the file.`
              : "") +
            ". Your recorded archive is still stored in this browser.";
        })()
          .catch(showError)
          .finally(() => {
            exporting = false;
            void refresh().catch(showError);
          });
      });
      actions.append(download);
    }
    article.append(title, detail, actions);
    $("archives").append(article);
  }
}
function showError(error: unknown) {
  $("error").textContent =
    error instanceof Error ? error.message : "Could not load archives.";
}
$("refresh").addEventListener("click", () => {
  void refresh().catch(showError);
});
void refresh().catch(showError);
