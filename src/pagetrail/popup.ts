// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import type { Session } from "./session";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let busy = false;
let tabId: number | undefined;
type Status = {
  session: Session | null;
  archives: {
    id: string;
    bytes: number;
    visual?: { states: number; documents: number; error: string };
  }[];
  stats: { numPending?: number } | null;
  error?: string;
};
function render(data: Status) {
  const s = data.session;
  $("state").textContent = s?.state || "READY";
  $("site").textContent = s?.origin || "Current tab";
  $("notice").textContent =
    s?.notice || "Start a session on the site you want to retain.";
  $("bytes").textContent =
    (
      (data.archives.find((item) => item.id === s?.id)?.bytes || 0) / 1048576
    ).toFixed(1) + " MB";
  $("pending").textContent = String(data.stats?.numPending || 0);
  const visual = data.archives.find((item) => item.id === s?.id)?.visual;
  $("visual").textContent = `${visual?.states || 0} states · ${
    visual?.documents || 0
  } documents in latest`;
  if (visual?.error)
    $("notice").textContent += " Capture warning: " + visual.error;
  $("consent").hidden = Boolean(s && s.state !== "STOPPED");
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
  if (action !== "status") busy = true;
  try {
    const data: Status = await chrome.runtime.sendMessage({
      method: "pagetrail.replay",
      action,
      tabId,
      acknowledged: $<HTMLInputElement>("ack").checked,
    });
    if (data.error) throw new Error(data.error);
    render(data);
    if (action !== "status") $("error").textContent = "";
  } catch (error) {
    $("error").textContent =
      error instanceof Error ? error.message : "Could not contact recorder.";
  } finally {
    busy = false;
    if (action !== "status") void run();
  }
}
for (const action of ["start", "pause", "resume", "finish"])
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
}, 2000);
window.addEventListener("pagehide", () => clearInterval(timer));
