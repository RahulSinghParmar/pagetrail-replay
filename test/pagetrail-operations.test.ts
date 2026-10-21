// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import {
  bounded,
  OperationError,
  safeErrorCode,
} from "../src/pagetrail/operations.ts";
import {
  runExportJob,
  type ExportWorker,
} from "../src/pagetrail/export-job.ts";
import { diagnosticEvent } from "../src/pagetrail/diagnostics.ts";
import type { ExportReply } from "../src/pagetrail/export-protocol.ts";
function worker() {
  let terminated = 0,
    posted = 0;
  const api: ExportWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage() {
      posted++;
    },
    terminate() {
      terminated++;
    },
  };
  return {
    api,
    stats: () => ({ terminated, posted }),
    emit: (data: ExportReply) =>
      api.onmessage?.({ data } as MessageEvent<ExportReply>),
  };
}
const request = { id: "fixture-only", format: "html" as const };
test("unanswered operations and cancellation settle without waiting indefinitely", async () => {
  await assert.rejects(
    bounded(new Promise(() => {}), { ms: 5, code: "STATUS_TIMEOUT" }),
    (error: OperationError) => error.code === "STATUS_TIMEOUT",
  );
  const controller = new AbortController();
  const waiting = bounded(new Promise(() => {}), {
    ms: 1000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    waiting,
    (error: OperationError) => error.code === "CANCELED",
  );
});
test("already-canceled deadlines still consume an underlying late rejection", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    bounded(Promise.reject(new Error("late failure")), {
      signal: controller.signal,
    }),
    (error: OperationError) => error.code === "CANCELED",
  );
  await new Promise((done) => setTimeout(done, 0));
});
test("worker result terminates its worker and ignores late messages", async () => {
  const w = worker(),
    phases: string[] = [];
  const promise = runExportJob(request, {
    worker: () => w.api,
    progress: (value) => phases.push(value.phase),
  });
  w.emit({
    kind: "progress",
    value: { phase: "embedding", done: 1, total: 2 },
  });
  w.emit({
    kind: "result",
    value: { blob: new Blob(["test"]), filename: "one.html", missing: 0 },
  });
  assert.equal((await promise).filename, "one.html");
  w.emit({ kind: "error", code: "UNEXPECTED_ERROR" });
  assert.deepEqual(w.stats(), { terminated: 1, posted: 1 });
  assert.deepEqual(phases, ["starting", "embedding"]);
});
test("cancel terminates actual work, not just its progress indicator", async () => {
  const w = worker(),
    controller = new AbortController();
  const promise = runExportJob(request, {
    worker: () => w.api,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    promise,
    (error: OperationError) => error.code === "CANCELED",
  );
  assert.equal(w.stats().terminated, 1);
});
test("silent worker timeout and worker crashes leave no live worker", async () => {
  const w = worker();
  await assert.rejects(
    runExportJob(request, { worker: () => w.api, idleMs: 5 }),
    (error: OperationError) => error.code === "EXPORT_TIMEOUT",
  );
  assert.equal(w.stats().terminated, 1);
  const broken = worker();
  const pending = runExportJob(request, { worker: () => broken.api });
  broken.api.onerror?.({ preventDefault() {} } as ErrorEvent);
  await assert.rejects(
    pending,
    (error: OperationError) => error.code === "WORKER_FAILED",
  );
  assert.equal(broken.stats().terminated, 1);
});
test("worker has an absolute deadline even while it keeps reporting progress", async () => {
  const w = worker();
  const updates = setInterval(
    () => w.emit({ kind: "progress", value: { phase: "embedding" } }),
    2,
  );
  try {
    await assert.rejects(
      runExportJob(request, { worker: () => w.api, idleMs: 1000, totalMs: 12 }),
      (error: OperationError) => error.code === "EXPORT_TIMEOUT",
    );
  } finally {
    clearInterval(updates);
  }
  assert.equal(w.stats().terminated, 1);
});
test("worker startup errors and actionable storage errors are reported safely", async () => {
  await assert.rejects(
    runExportJob(request, {
      worker: () => {
        throw new Error("https://private.example/token?secret=value");
      },
    }),
    /background exporter is unavailable/,
  );
  const w = worker(),
    promise = runExportJob(request, { worker: () => w.api });
  w.emit({ kind: "error", code: "STORAGE_BLOCKED" });
  await assert.rejects(promise, /Close other PageTrail library tabs/);
});
test("diagnostic event runtime allowlist excludes page data, URLs, IDs and raw errors", () => {
  const event = diagnosticEvent("export", "EXPORT_STOPPED", {
    phase: "embedding",
    format: "html",
    states: 120,
    elapsedMs: 200,
    bytes: Infinity,
    errorCode: "UNEXPECTED_ERROR",
    ...{
      url: "https://private.example/token",
      title: "Secret title",
      archiveId: "private-id",
      rawError: "password=SECRET",
      token: "secret",
    },
  });
  const text = JSON.stringify(event);
  assert.equal(event.fields.states, 120);
  assert.doesNotMatch(text, /private|Secret|SECRET|password|token|Infinity/);
  assert.equal(
    diagnosticEvent("export", "SECRET_TITLE").code,
    "UNCLASSIFIED_EVENT",
  );
  assert.equal(safeErrorCode(new Error("password=secret")), "UNEXPECTED_ERROR");
});
