// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Session } from "./session";
import { coverageText, type CoverageSummary } from "./coverage";
import { runExportJob } from "./export-job";
import {
  phaseLabel,
  type ExportFile,
  type ExportFormat,
  type ExportProgress,
  type ExportRequest,
} from "./export-protocol";
import { saveLocalFile } from "./download";
import { bounded, checkAbort, safeErrorCode } from "./operations";
import {
  diagnosticReport,
  installErrorDiagnostics,
  readDiagnostics,
  recordDiagnostic,
} from "./diagnostics";
export type LibraryStatus = {
  error?: string;
  session: Session | null;
  archives: {
    id: string;
    title: string;
    bytes: number;
    coverage?: CoverageSummary;
    visual?: {
      states: number;
      documents: number;
      bytes: number;
      error: string;
    };
  }[];
};
export type DashboardDependencies = {
  status: () => Promise<LibraryStatus>;
  check?: () => Promise<Pick<LibraryStatus, "session" | "error">>;
  export?: (
    request: ExportRequest,
    options: { signal: AbortSignal; progress: (value: ExportProgress) => void },
  ) => Promise<ExportFile>;
  save?: typeof saveLocalFile;
  statusMs?: number;
};
export function mountDashboard(deps: DashboardDependencies) {
  const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const save = deps.save || saveLocalFile;
  let active: AbortController | null = null,
    ready: ExportFile | null = null,
    lastRequest: ExportRequest | null = null;
  let began = 0,
    phase: ExportProgress = { phase: "checking" },
    lastPhase = "",
    refreshGeneration = 0;
  installErrorDiagnostics();
  const busy = () => {
    $("refresh").toggleAttribute("disabled", !!active);
    for (const el of document.querySelectorAll<
      HTMLButtonElement | HTMLSelectElement
    >("[data-export-control]"))
      el.disabled = !!active;
    $<HTMLButtonElement>("cancel").disabled = !active;
    $<HTMLButtonElement>("retry").disabled = !!active || !lastRequest;
    $<HTMLButtonElement>("save-ready").disabled = !!active || !ready;
    $("save-ready").hidden = !ready;
  };
  const progress = (value: ExportProgress) => {
    phase = value;
    $("job-status").textContent = phaseLabel(value);
    const meter = $<HTMLProgressElement>("job-progress");
    if (value.total) {
      meter.max = value.total;
      meter.value = value.done || 0;
    } else meter.removeAttribute("value");
    if (lastPhase !== value.phase) {
      lastPhase = value.phase;
      void recordDiagnostic(
        value.phase === "downloading" || value.phase === "save-dialog"
          ? "download"
          : "export",
        "PHASE_CHANGED",
        {
          phase: value.phase,
          format: lastRequest?.format,
          elapsedMs: performance.now() - began,
          done: value.done,
          total: value.total,
          bytes: value.bytes,
        },
      );
    }
  };
  const safeStatus = () =>
    bounded(deps.status(), {
      ms: deps.statusMs ?? 8000,
      signal: active?.signal,
      code: "STATUS_TIMEOUT",
      message:
        "The recorder did not respond. Reload the same extension, keep this library tab open, and retry. Your saved recording was not deleted.",
    });
  async function refresh() {
    const generation = ++refreshGeneration;
    $("library-status").textContent = "Reading local recordings…";
    try {
      const result = await safeStatus();
      if (result.error) throw new Error("Recorder status is unavailable.");
      if (generation !== refreshGeneration) return;
      $("archives").replaceChildren();
      for (const archive of result.archives) {
        const article = document.createElement("article"),
          heading = document.createElement("h2"),
          info = document.createElement("small"),
          row = document.createElement("div"),
          label = document.createElement("label"),
          select = document.createElement("select"),
          button = document.createElement("button");
        heading.textContent = archive.title;
        row.className = "buttons";
        info.textContent = archive.visual?.states
          ? `${archive.visual.states} captured states · ${
              archive.visual.documents
            } documents in latest · ${(archive.visual.bytes / 1048576).toFixed(
              1,
            )} MB visual data`
          : "Older recording · text and WACZ exports only";
        if (archive.visual?.error)
          info.textContent +=
            " · Capture warning: review coverage in the exported file";
        const coverage = document.createElement("p");
        coverage.className = "muted";
        coverage.textContent = coverageText(archive.coverage);
        const unfinished =
          result.session?.id === archive.id &&
          result.session.state !== "STOPPED";
        if (unfinished)
          info.textContent +=
            " · Finish recording before content export; coverage report remains available";
        label.textContent = "Format ";
        select.setAttribute("aria-label", "Export format for " + archive.title);
        for (const [value, text] of [
          ["html", "Website · single HTML"],
          ["md", "Notes · Markdown"],
          ["reading", "Text-only HTML"],
          ["wacz", "Replay archive · WACZ"],
          ["learning", "Portable learning package · ZIP"],
          ["coverage", "Capture coverage · JSON"],
        ] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          option.disabled =
            (unfinished && value !== "coverage") ||
            (value === "html" && !archive.visual?.states) ||
            (value === "wacz" && !archive.bytes);
          select.append(option);
        }
        select.value = archive.visual?.states ? "html" : "md";
        button.textContent = "Export";
        button.className = "primary";
        select.dataset.exportControl = "";
        button.dataset.exportControl = "";
        if (unfinished) select.value = "coverage";
        select.disabled = button.disabled = !!active;
        button.addEventListener("click", () => {
          void start({
            id: archive.id,
            title: archive.title,
            format: select.value as ExportFormat,
          });
        });
        label.append(select);
        row.append(label, button);
        article.append(heading, info, coverage, row);
        $("archives").append(article);
      }
      $("library-status").textContent = result.archives.length
        ? `${result.archives.length} local recording${
            result.archives.length === 1 ? "" : "s"
          }`
        : "No recordings yet. Start a session from the extension popup.";
      busy();
    } catch (error) {
      $("library-status").textContent =
        error instanceof Error
          ? error.message
          : "Could not read the library. Retry Refresh.";
      void recordDiagnostic("ui", "LIBRARY_FAILED", {
        errorCode: safeErrorCode(error),
      });
    }
  }
  async function download(signal: AbortSignal) {
    const file = ready!;
    progress({ phase: "save-dialog" });
    const result = await save(file.blob, file.filename, { signal, progress });
    checkAbort(signal);
    $("job-status").textContent =
      result === "complete"
        ? `Saved ${file.filename}`
        : `Download requested: ${file.filename}. Check your browser’s Downloads.`;
    if (file.missing)
      $("job-detail").textContent =
        `${file.missing} coverage warnings or missing/unsupported references; review the coverage report. Your source recording remains stored.`;
    else
      $("job-detail").textContent =
        "Your recording is still stored locally. Save ready file retries this file without rebuilding it.";
    $<HTMLProgressElement>("job-progress").max = 1;
    $<HTMLProgressElement>("job-progress").value = 1;
    void recordDiagnostic("download", "DOWNLOAD_FINISHED", {
      outcome: result === "complete" ? "success" : "requested",
      bytes: file.blob.size,
      elapsedMs: performance.now() - began,
    });
  }
  async function start(request: ExportRequest, readyOnly = false) {
    if (active) return;
    const controller = new AbortController();
    active = controller;
    began = performance.now();
    lastPhase = "";
    lastRequest = request;
    if (!readyOnly) ready = null;
    $("job").hidden = false;
    $("job-detail").textContent =
      "Preparation runs in a background worker. You can cancel safely; no recording is deleted.";
    busy();
    void recordDiagnostic("export", "EXPORT_STARTED", {
      format: request.format,
    });
    try {
      if (!readyOnly) {
        progress({ phase: "checking" });
        const latest = await bounded((deps.check || deps.status)(), {
          signal: controller.signal,
          ms: deps.statusMs ?? 8000,
          code: "STATUS_TIMEOUT",
          message:
            "The recorder did not respond. Reload the same extension, keep this library tab open, and retry. Your saved recording was not deleted.",
        });
        checkAbort(controller.signal);
        if (latest.error)
          throw new Error(
            "The recorder could not confirm status. Refresh the library and retry.",
          );
        if (
          latest.session?.id === request.id &&
          latest.session.state !== "STOPPED" &&
          request.format !== "coverage"
        )
          throw new Error("Finish this recording before exporting.");
        ready = await (deps.export || runExportJob)(request, {
          signal: controller.signal,
          progress,
        });
        checkAbort(controller.signal);
        progress({ phase: "ready", bytes: ready.blob.size });
        $("job-detail").textContent = `File prepared · ${(
          ready.blob.size / 1048576
        ).toFixed(2)} MB. Keep the tab open until saving finishes.`;
        void recordDiagnostic("export", "FILE_READY", {
          format: request.format,
          bytes: ready.blob.size,
          elapsedMs: performance.now() - began,
        });
      }
      await download(controller.signal);
    } catch (error) {
      const code = safeErrorCode(error);
      $("job-status").textContent =
        error instanceof Error
          ? error.message
          : "Export failed. Your recording is preserved.";
      $("job-detail").textContent =
        code === "CANCELED"
          ? "Nothing was deleted. Dismiss any open browser Save dialog. You can retry."
          : `Stopped at: ${phaseLabel(phase)}. ${
              ready
                ? "The prepared file is still available below."
                : "Retry or save the local diagnostic report."
            }`;
      $<HTMLProgressElement>("job-progress").max = 1;
      $<HTMLProgressElement>("job-progress").value = 0;
      void recordDiagnostic("export", "EXPORT_STOPPED", {
        format: request.format,
        phase: phase.phase,
        errorCode: code,
        outcome: code === "CANCELED" ? "canceled" : "failure",
        elapsedMs: performance.now() - began,
      });
    } finally {
      $("elapsed").textContent =
        ((performance.now() - began) / 1000).toFixed(1) + " s";
      if (active === controller) active = null;
      busy();
      void showDiagnostics();
    }
  }
  async function showDiagnostics() {
    if (!$<HTMLDetailsElement>("diagnostics").open) return;
    const events = await readDiagnostics();
    const logs = $("logs"),
      follow = logs.scrollTop + logs.clientHeight >= logs.scrollHeight - 32;
    logs.textContent =
      events
        .slice(-30)
        .map(
          (event) =>
            `${event.time.slice(11, 19)}  ${event.source}  ${
              event.code
            }  ${JSON.stringify(event.fields)}`,
        )
        .join("\n") || "No diagnostic events yet.";
    if (follow) logs.scrollTop = logs.scrollHeight;
  }
  $("cancel").addEventListener("click", () => active?.abort());
  $("retry").addEventListener("click", () => {
    if (lastRequest) void start(lastRequest);
  });
  $("save-ready").addEventListener("click", () => {
    if (ready && lastRequest) void start(lastRequest, true);
  });
  $("refresh").addEventListener("click", () => {
    if (!active) void refresh();
  });
  $("diagnostics").addEventListener("toggle", () => {
    void showDiagnostics();
  });
  $("report").addEventListener("click", () => {
    void (async () => {
      const report = await diagnosticReport();
      await save(
        new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        }),
        "PageTrail-diagnostics.json",
      );
      $("report-notice").textContent =
        "Diagnostic report download requested. It contains operation codes, timings and counts—not page content or URLs.";
    })().catch(() => {
      $("report-notice").textContent =
        "Could not save the report. You can still read local events above.";
    });
  });
  const timer = setInterval(() => {
    if (active)
      $("elapsed").textContent =
        ((performance.now() - began) / 1000).toFixed(1) + " s";
    void showDiagnostics();
  }, 1000);
  window.addEventListener("pagehide", () => {
    active?.abort();
    clearInterval(timer);
  });
  void refresh();
  return { refresh, start, cancel: () => active?.abort() };
}
