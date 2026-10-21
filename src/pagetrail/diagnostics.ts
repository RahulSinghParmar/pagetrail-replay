// SPDX-License-Identifier: AGPL-3.0-or-later
import { openDB } from "idb";
import { bounded, safeErrorCode } from "./operations";
import type { ExportFormat, ExportPhase } from "./export-protocol";
export type DiagnosticEvent = {
  time: string;
  source: "capture" | "control" | "export" | "download" | "ui";
  code: string;
  fields: DiagnosticFields;
};
export type DiagnosticFields = {
  phase?: ExportPhase;
  format?: ExportFormat;
  elapsedMs?: number;
  states?: number;
  documents?: number;
  resources?: number;
  bytes?: number;
  done?: number;
  total?: number;
  errorCode?: string;
  outcome?: "success" | "failure" | "canceled" | "requested";
};
const LIMIT = 200;
const EVENT_CODES = new Set([
  "UNCLASSIFIED_EVENT",
  "EXPORT_STARTED",
  "PHASE_CHANGED",
  "FILE_READY",
  "EXPORT_STOPPED",
  "DOWNLOAD_FINISHED",
  "LIBRARY_FAILED",
  "UNHANDLED_ERROR",
  "UNHANDLED_REJECTION",
  "STATE_SAVED",
  "CAPTURE_FAILED",
  "RECORDER_ACTION_FINISHED",
  "RECORDER_ACTION_FAILED",
  "POPUP_REQUEST_FAILED",
]);
const NUMBER_FIELDS = new Set([
  "elapsedMs",
  "states",
  "documents",
  "resources",
  "bytes",
  "done",
  "total",
]);
const VALUES: Record<string, Set<string>> = {
  phase: new Set([
    "checking",
    "starting",
    "opening",
    "reading-states",
    "reading-assets",
    "embedding",
    "reading-text",
    "building",
    "ready",
    "save-dialog",
    "downloading",
    "complete",
  ]),
  format: new Set(["html", "reading", "md", "wacz", "coverage", "learning"]),
  outcome: new Set(["success", "failure", "canceled", "requested"]),
  errorCode: new Set([
    "CANCELED",
    "TIMEOUT",
    "STATUS_TIMEOUT",
    "EXPORT_TIMEOUT",
    "WORKER_FAILED",
    "STORAGE_BLOCKED",
    "SAVE_DIALOG_TIMEOUT",
    "DOWNLOAD_TIMEOUT",
    "DOWNLOAD_INTERRUPTED",
    "NO_VISUAL_STATES",
    "EXPORT_TOO_LARGE",
    "MISSING_ASSET",
    "FINISH_TIMEOUT",
    "STORAGE_FAILED",
    "CAPTURE_EXCLUDED",
    "UNEXPECTED_ERROR",
    "QuotaExceededError",
    "VersionError",
    "DataError",
    "NotFoundError",
    "SecurityError",
    "AbortError",
    "InvalidStateError",
  ]),
};
// Runtime allowlist, not merely a TypeScript promise. Never persist URLs, titles,
// page text, selectors, raw errors/stacks, request data, credentials or archive IDs.
export function diagnosticEvent(
  source: DiagnosticEvent["source"],
  code: string,
  fields: DiagnosticFields = {},
): DiagnosticEvent {
  const clean: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (
      NUMBER_FIELDS.has(key) &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
    )
      clean[key] = Math.round(value);
    if (typeof value === "string" && VALUES[key]?.has(value))
      clean[key] = value;
  }
  return {
    time: new Date().toISOString(),
    source: ["capture", "control", "export", "download", "ui"].includes(source)
      ? source
      : "ui",
    code: EVENT_CODES.has(code) ? code : "UNCLASSIFIED_EVENT",
    fields: clean as DiagnosticFields,
  };
}
async function database() {
  const opening = openDB("pagetrail-diagnostics-v1", 1, {
    upgrade(db) {
      db.createObjectStore("events", { autoIncrement: true });
    },
  });
  try {
    return await bounded(opening, { ms: 2000 });
  } catch (error) {
    void opening.then((db) => db.close()).catch(() => {});
    throw error;
  }
}
const fallback: DiagnosticEvent[] = [];
export async function recordDiagnostic(
  source: DiagnosticEvent["source"],
  code: string,
  fields: DiagnosticFields = {},
): Promise<void> {
  const event = diagnosticEvent(source, code, fields);
  try {
    const db = await database();
    try {
      const tx = db.transaction("events", "readwrite"),
        store = tx.objectStore("events");
      await store.add(event);
      const keys = await store.getAllKeys();
      for (const key of keys.slice(0, Math.max(0, keys.length - LIMIT)))
        await store.delete(key);
      await tx.done;
    } finally {
      db.close();
    }
  } catch {
    fallback.push(event);
    if (fallback.length > LIMIT) fallback.shift();
  }
}
export async function readDiagnostics(): Promise<DiagnosticEvent[]> {
  try {
    const db = await database();
    try {
      return [...(await db.getAll("events")), ...fallback]
        .sort((a, b) => a.time.localeCompare(b.time))
        .slice(-LIMIT);
    } finally {
      db.close();
    }
  } catch {
    return [...fallback];
  }
}
export async function diagnosticReport() {
  let storage: { usage?: number; quota?: number } = {};
  try {
    const estimate = await bounded(navigator.storage.estimate(), { ms: 1500 });
    storage = { usage: estimate.usage, quota: estimate.quota };
  } catch {
    /* optional */
  }
  return {
    schema: 1,
    build: "0.1.2-phase2-capture",
    created: new Date().toISOString(),
    privacy:
      "Local operation codes, timings and counts only. No page content, URLs, titles, identifiers, credentials or raw error stacks.",
    storage,
    events: await readDiagnostics(),
  };
}
export function installErrorDiagnostics() {
  window.addEventListener("error", () => {
    void recordDiagnostic("ui", "UNHANDLED_ERROR", {
      errorCode: "UNEXPECTED_ERROR",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    void recordDiagnostic("ui", "UNHANDLED_REJECTION", {
      errorCode: safeErrorCode(event.reason),
    });
  });
}
