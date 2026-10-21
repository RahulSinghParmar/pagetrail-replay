// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import type { Session } from "./session";
import type { CrawlState } from "./crawl";
import { bounded, safeErrorCode } from "./operations";
import { recordDiagnostic } from "./diagnostics";
import { coverageText, type CoverageSummary } from "./coverage";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let busy = false;
let tabId: number | undefined;
let lastData: Status | null = null;
let polling = false;
let generation = 0;
type Status = {
  session: Session | null;
  archives: {
    id: string;
    bytes: number;
    coverage?: CoverageSummary;
    visual?: { states: number; documents: number; error: string };
  }[];
  stats: { numPending?: number } | null;
  error?: string;
  crawl?: CrawlState | null;
};
function render(data: Status) {
  const s = data.session;
  const crawl = data.crawl?.config.sessionId === s?.id ? data.crawl : null;
  $("crawl-status").textContent = crawl
    ? `${crawl.state} · ${
        crawl.pages.filter((p) => p.state === "visited").length
      } visited · ${
        crawl.pages.filter((p) => p.state === "queued").length
      } queued · ${
        crawl.pages.filter((p) => p.state === "failed").length
      } failed · ${crawl.skipped} skipped. ${crawl.notice}`
    : "Follow ordinary links within your chosen path. Start recording first.";
  $("crawl-boundary").textContent = crawl
    ? crawl.config.origin + crawl.config.path
    : s?.origin || "Current recording site";
  for (const action of ["start", "pause", "resume", "stop"]) {
    const enabled =
      action === "start"
        ? s?.state === "RECORDING" && crawl?.state !== "RUNNING"
        : action === "resume"
          ? s?.state === "RECORDING" && crawl?.state === "PAUSED"
          : action === "pause"
            ? crawl?.state === "RUNNING"
            : crawl && ["RUNNING", "PAUSED"].includes(crawl.state);
    $<HTMLButtonElement>("crawl-" + action).disabled = busy || !enabled;
  }
  for (const id of ["crawl-path", "crawl-pages", "crawl-depth", "crawl-ack"])
    $<HTMLInputElement>(id).disabled = busy || crawl?.state === "RUNNING";
  $("state").textContent = s?.state || "READY";
  $("site").textContent = s ? s.origin + (s.pathPrefix || "") : "Current tab";
  $("notice").textContent =
    s?.notice || "Start a session on the site you want to retain.";
  $("bytes").textContent =
    (
      (data.archives.find((item) => item.id === s?.id)?.bytes || 0) / 1048576
    ).toFixed(1) + " MB";
  const coverage = data.archives.find((item) => item.id === s?.id)?.coverage;
  $("pending").textContent = String(
    coverage?.counts.pending ?? data.stats?.numPending ?? 0,
  );
  $("coverage").textContent = coverageText(coverage);
  const visual = data.archives.find((item) => item.id === s?.id)?.visual;
  $("visual").textContent = `${visual?.states || 0} states · ${
    visual?.documents || 0
  } documents in latest`;
  if (visual?.error)
    $("notice").textContent += " Capture warning: " + visual.error;
  $("consent").hidden = Boolean(s && s.state !== "STOPPED");
  $("path-option").hidden = Boolean(s && s.state !== "STOPPED");
  const allowed: Record<string, boolean> = {
    start: !s || s.state === "STOPPED",
    pause: s?.state === "RECORDING",
    resume: s?.state === "PAUSED",
    finish: !!s && ["PAUSED", "RECORDING", "ERROR"].includes(s.state),
  };
  for (const [action, enabled] of Object.entries(allowed))
    $<HTMLButtonElement>(action).disabled = busy || !enabled;
}
async function run(action = "status") {
  if (busy) return;
  busy = true;
  generation++;
  if (lastData) render(lastData);
  try {
    const data: Status = await bounded(
      chrome.runtime.sendMessage({
        method: "pagetrail.replay",
        action,
        tabId,
        acknowledged: $<HTMLInputElement>("ack").checked,
        pathPrefix: $<HTMLInputElement>("path-prefix").value,
        crawlPath: $<HTMLInputElement>("crawl-path").value,
        maxPages: Number($<HTMLInputElement>("crawl-pages").value),
        maxDepth: Number($<HTMLInputElement>("crawl-depth").value),
        crawlAcknowledged: $<HTMLInputElement>("crawl-ack").checked,
      }),
      {
        ms: action === "status" ? 8000 : 45000,
        code: "STATUS_TIMEOUT",
        message:
          "The recorder is not responding. Keep the tab open; inspect Local diagnostics in the library. Do not clear storage.",
      },
    );
    if (data.error) throw new Error(data.error);
    lastData = data;
    if (action !== "status") $("error").textContent = "";
  } catch (error) {
    void recordDiagnostic("ui", "POPUP_REQUEST_FAILED", {
      errorCode: safeErrorCode(error),
    });
    $("error").textContent =
      error instanceof Error ? error.message : "Could not contact recorder.";
  } finally {
    busy = false;
    if (lastData) render(lastData);
  }
}
async function pollWhileFinishing() {
  if (polling || !lastData) return;
  polling = true;
  const started = generation;
  try {
    const data: Status = await bounded(
      chrome.runtime.sendMessage({
        method: "pagetrail.replay",
        action: "status",
      }),
      { ms: 8000 },
    );
    if (busy && started === generation && !data.error) {
      lastData = data;
      render(data);
    }
  } catch {
    /* The action's own deadline reports failure; polling never unlocks controls. */
  } finally {
    polling = false;
  }
}
for (const action of [
  "start",
  "pause",
  "resume",
  "finish",
  "crawl-start",
  "crawl-pause",
  "crawl-resume",
  "crawl-stop",
])
  $(action).addEventListener("click", () => {
    if (!busy) void run(action);
  });
$("library").addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});
void chrome.tabs
  .query({ active: true, currentWindow: true })
  .then((tabs: { id: number }[]) => {
    tabId = tabs[0]?.id;
    return run();
  });
const timer = setInterval(() => {
  if (!busy) void run();
  else void pollWhileFinishing();
}, 2000);
window.addEventListener("pagehide", () => clearInterval(timer));
