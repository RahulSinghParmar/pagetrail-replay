// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import {
  CoverageLedger,
  coverageText,
  coverageGaps,
  RESOURCE_LIMIT,
  SESSION_LIMIT,
} from "../src/pagetrail/coverage.ts";
import { CaptureWork, waitForQuiet } from "../src/pagetrail/capture-work.ts";
import { inScope, scopePath } from "../src/pagetrail/scope.ts";
import { bounded, type OperationError } from "../src/pagetrail/operations.ts";
const request = (path = "/lesson", status = 200) => ({
  url: "https://learn.example.test" + path,
  method: "GET",
  resourceType: "Document",
  status,
});
test("exact origin and optional path use segment boundaries, not string prefixes", () => {
  const origin = "https://learn.example.test";
  for (const raw of [origin + "/course", origin + "/course/a?unit=2#lesson"])
    assert(inScope(origin, raw, "/course/"));
  for (const raw of [
    origin + "/coursework",
    origin + "/account",
    origin + "/course%2f..%2faccount",
    "https://child.learn.example.test/course",
    "https://user:secret@learn.example.test/course",
    origin + ":8443/course",
  ])
    assert(!inScope(origin, raw, "/course"));
  for (const value of [
    "https://other.test",
    "/course?all=true",
    "/course#tab",
    "/course/../account",
    "/course/%2e%2e/account",
    "/course%2fsecret",
    "/%zz",
    "/course\\account",
  ])
    assert.throws(() => scopePath(value));
  assert.equal(scopePath("/"), undefined);
  assert.equal(scopePath("/course/"), "/course");
});
test("same-URL requests remain distinct and are saved only after confirmed storage", () => {
  const ledger = new CoverageLedger("test"),
    first = request(),
    second = request();
  ledger.requested(first);
  ledger.requested(second);
  const data = { ...first, payload: new Uint8Array([1, 2]) };
  ledger.bind(data, first);
  assert.equal(ledger.snapshot().counts.saved, 0);
  ledger.stored(data, true);
  ledger.outcome(second, "failed", "NETWORK_FAILED");
  ledger.outcome(second, "saved", "CAPTURED");
  assert.deepEqual(ledger.snapshot().counts, {
    pending: 0,
    saved: 1,
    failed: 1,
    excluded: 0,
    unsupported: 0,
    unavailable: 0,
  });
  assert.equal(ledger.batch().entries.length, 2);
});
test("redirect binding preserves the old attempt when the engine reuses its request object", () => {
  const ledger = new CoverageLedger("test"),
    hop = request("/start", 302);
  ledger.requested(hop);
  const redirect = { ...hop, payload: new Uint8Array() };
  ledger.bind(redirect, hop);
  hop.url = "https://learn.example.test/target";
  hop.status = 200;
  ledger.requested(hop);
  ledger.stored(redirect, true);
  ledger.outcome(hop, "unavailable", "BODY_UNAVAILABLE");
  const entries = ledger.batch().entries;
  assert.equal(entries[0].source, "https://learn.example.test/start");
  assert.equal(entries[0].state, "saved");
  assert.equal(entries[1].state, "unavailable");
});
test("authentication, unsupported streams and skipped preflights are explicitly classified", () => {
  const ledger = new CoverageLedger("test");
  ledger.requested(request("/api/token?secret=private"));
  ledger.requested({ ...request(), resourceType: "WebSocket" });
  ledger.requested({ ...request(), resourceType: "EventSource" });
  ledger.requested({ ...request(), method: "OPTIONS" });
  const counts = ledger.snapshot().counts;
  assert.equal(counts.excluded, 2);
  assert.equal(counts.unsupported, 2);
  assert.equal(counts.pending, 0);
  assert.doesNotMatch(JSON.stringify(ledger.batch()), /private|secret=/);
});
test("saved HTTP errors are not represented as successful coverage", () => {
  const ledger = new CoverageLedger("test"),
    req = request("/missing", 404);
  ledger.requested(req);
  const data = { ...req, payload: new Uint8Array([1]) };
  ledger.bind(data, req);
  ledger.stored(data, true);
  assert.equal(ledger.snapshot().counts.failed, 1);
  assert.equal(ledger.batch().entries[0].reason, "HTTP_ERROR");
});
test("native deduplication may remove payload bytes without erasing coverage byte counts", () => {
  const ledger = new CoverageLedger("test"),
    req = request();
  ledger.requested(req);
  const data: { payload?: Uint8Array; ts: number } = {
    payload: new Uint8Array(128),
    ts: 12345,
  };
  ledger.bind(data, req);
  delete data.payload;
  ledger.stored(data, true);
  const entry = ledger.batch().entries[0];
  assert.equal(entry.bytes, 128);
  assert.equal(entry.archiveTime, 12345);
});
test("tracking overflow does not repeatedly count the same untracked request during callbacks", () => {
  const ledger = new CoverageLedger("test", undefined, 0),
    req = request();
  ledger.requested(req);
  ledger.outcome(req, "unavailable", "BODY_UNAVAILABLE");
  ledger.bind({}, req);
  assert.equal(ledger.snapshot().observed, 1);
  assert.equal(ledger.snapshot().dropped, 1);
});
test("failed storage and missing cached bodies stay visible through finish", () => {
  const ledger = new CoverageLedger("test"),
    one = request(),
    two = request("/cached"),
    three = request("/slow");
  for (const req of [one, two, three]) ledger.requested(req);
  const data = { ...one };
  ledger.bind(data, one);
  ledger.stored(data, false);
  ledger.outcome(two, "unavailable", "CACHE_BODY_UNAVAILABLE");
  ledger.unfinished("FINISH_TIMEOUT");
  ledger.finish(true);
  assert.equal(ledger.snapshot().counts.failed, 1);
  assert.equal(ledger.snapshot().counts.unavailable, 2);
  assert.equal(ledger.snapshot().counts.pending, 0);
  assert(coverageGaps(ledger.snapshot()) >= 3);
  assert.match(coverageText(ledger.snapshot()), /observed requests only/);
});
test("resume/restart preserves historical coverage and marks unresolved requests interrupted", () => {
  const ledger = new CoverageLedger("test");
  ledger.requested(request());
  const resumed = new CoverageLedger("test", ledger.batch());
  assert.equal(resumed.snapshot().counts.unavailable, 1);
  assert(resumed.snapshot().interrupted);
  resumed.requested(request());
  assert.equal(resumed.snapshot().observed, 2);
  assert.equal(resumed.batch().entries.length, 2);
});
test("budget reservations prevent concurrent writes from exceeding the session allowance", () => {
  const ledger = new CoverageLedger("test"),
    req = request();
  assert.equal(ledger.rejection(req, RESOURCE_LIMIT + 1), "RESOURCE_LIMIT");
  ledger.reserve(SESSION_LIMIT - 1);
  assert.equal(ledger.rejection(req, 2), "SESSION_LIMIT");
  ledger.release(SESSION_LIMIT - 1, false);
  assert.equal(ledger.rejection(req, 2), undefined);
  ledger.reserve(10);
  ledger.release(10, true);
  assert.equal(ledger.snapshot().bytes, 10);
});
test("coverage is bounded, records tracking overflow and can retry dirty writes", () => {
  const ledger = new CoverageLedger("test", undefined, 1);
  ledger.requested(request());
  ledger.requested(request("/other"));
  const batch = ledger.batch();
  assert.equal(batch.entries.length, 1);
  assert.equal(batch.summary.dropped, 1);
  assert.equal(batch.summary.observed, 2);
  ledger.restoreDirty(batch.entries);
  ledger.persistenceFailure();
  assert.equal(ledger.batch().entries.length, 1);
  assert.match(coverageText(ledger.snapshot()), /storage failed/);
  assert.match(coverageText(null), /unavailable/);
  assert(coverageGaps(null) > 0);
});
test("coverage locations never contain URL credentials, query strings or fragments", () => {
  const ledger = new CoverageLedger("test");
  ledger.requested({
    ...request(),
    url: "https://user:password@learn.example.test/course?token=SECRET#PRIVATE",
  });
  const text = JSON.stringify(ledger.batch());
  assert.doesNotMatch(text, /user|password|SECRET|PRIVATE|token=/);
  assert.match(text, /learn.example.test\/course/);
});
test("unsupported data and blob URLs cannot leak embedded bodies or credentials into reports", () => {
  const ledger = new CoverageLedger("test");
  ledger.requested({ url: "data:text/html,DO_NOT_LOG_PAGE_BODY" });
  ledger.requested({ url: "blob:https://user:password@learn.example.test/private" });
  const report = JSON.stringify(ledger.batch());
  assert.doesNotMatch(report, /DO_NOT_LOG|user|password|private/);
  assert.equal(ledger.snapshot().counts.unsupported, 2);
});
test("drain waits for nested body/commit work, including fire-and-forget failures", async () => {
  const work = new CaptureWork(),
    order: string[] = [];
  work.track(
    new Promise<void>((resolve) =>
      setTimeout(() => {
        work.track(
          new Promise<void>((done) =>
            setTimeout(() => {
              order.push("stored");
              done();
            }, 5),
          ),
        );
        order.push("body");
        resolve();
      }, 5),
    ),
  );
  await work.idle();
  order.push("closed");
  assert.deepEqual(order, ["body", "stored", "closed"]);
  const failed = work.track(Promise.reject(new Error("storage")));
  await assert.rejects(failed);
  await work.idle();
  assert.equal(work.size, 0);
});
test("quiet detection is bounded for unfinished requests and resets on new work", async () => {
  assert.equal(
    await waitForQuiet(() => 1, { timeoutMs: 8, quietMs: 2, pollMs: 1 }),
    false,
  );
  let pending = 1;
  setTimeout(() => {
    pending = 0;
  }, 3);
  assert.equal(
    await waitForQuiet(() => pending, {
      timeoutMs: 100,
      quietMs: 3,
      pollMs: 1,
    }),
    true,
  );
});
test("a hung drain times out without discarding tracked work or falsely confirming it", async () => {
  const work = new CaptureWork();
  let release!: () => void;
  work.track(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await assert.rejects(
    bounded(work.idle(), { ms: 5, code: "FINISH_TIMEOUT" }),
    (error: OperationError) => error.code === "FINISH_TIMEOUT",
  );
  assert.equal(work.size, 1);
  release();
  await work.idle();
  assert.equal(work.size, 0);
});
