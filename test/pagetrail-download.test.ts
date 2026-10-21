// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { confirmedDownload, responseBlob } from "../src/pagetrail/download.ts";
test("object URL remains alive until browser confirms completed download", async () => {
  const events: string[] = [];
  let calls = 0;
  await confirmedDownload(
    new Blob(["one HTML"]),
    "book.html",
    {
      download: async (options) => {
        assert.equal(options.url, "blob:local");
        assert(options.saveAs);
        events.push("download");
        return 7;
      },
      search: async (query) => {
        assert.equal(query.id, 7);
        events.push("search");
        return [{ state: ++calls === 1 ? "in_progress" : "complete" }];
      },
    },
    {
      makeUrl: () => "blob:local",
      revoke: () => events.push("revoke"),
      wait: async () => {
        assert(!events.includes("revoke"));
      },
      attempts: 3,
    },
  );
  assert.deepEqual(events, ["download", "search", "search", "revoke"]);
});
test("canceled and failed downloads are not reported successful", async () => {
  let revoked = false;
  await assert.rejects(
    confirmedDownload(
      new Blob(["text"]),
      "book.md",
      {
        download: async () => 4,
        search: async () => [{ state: "interrupted", error: "USER_CANCELED" }],
      },
      {
        makeUrl: () => "blob:local",
        revoke: () => {
          revoked = true;
        },
      },
    ),
    /USER_CANCELED/,
  );
  assert(revoked);
});
test("pending download is not broken by revoking its Blob URL", async () => {
  let revoked = false;
  await assert.rejects(
    confirmedDownload(
      new Blob(["text"]),
      "book.html",
      {
        download: async () => 4,
        search: async () => [{ state: "in_progress" }],
      },
      {
        makeUrl: () => "blob:local",
        revoke: () => {
          revoked = true;
        },
        wait: async () => {},
        attempts: 2,
      },
    ),
    /still pending/,
  );
  assert(!revoked);
});
test("local response conversion propagates stream errors and blocks empty or oversized output", async () => {
  const blob = await responseBlob(new Response("Unicode हिन्दी"));
  assert.equal(await blob.text(), "Unicode हिन्दी");
  await assert.rejects(responseBlob(new Response("")), /empty file/);
  await assert.rejects(
    responseBlob(new Response("too large"), () => {}, 2),
    /safety limit/,
  );
  await assert.rejects(
    responseBlob(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("broken stream"));
          },
        }),
      ),
    ),
    /broken stream/,
  );
});
test("hung Save picker times out and cancels an ID returned after timeout", async () => {
  let resolve!: (id: number) => void,
    canceled = 0,
    revoked = false;
  const pending = new Promise<number>((done) => {
    resolve = done;
  });
  await assert.rejects(
    confirmedDownload(
      new Blob(["test"]),
      "file.html",
      {
        download: () => pending,
        search: async () => [],
        cancel: async (id) => {
          canceled = id;
        },
      },
      {
        dialogMs: 5,
        makeUrl: () => "blob:test",
        revoke: () => {
          revoked = true;
        },
      },
    ),
    /Save dialog did not finish/,
  );
  resolve(9);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(canceled, 9);
  assert(revoked);
});
test("download cancellation cancels the native download without removing source data", async () => {
  const controller = new AbortController(),
    states: string[] = [];
  let canceled = 0;
  await assert.rejects(
    confirmedDownload(
      new Blob(["test"]),
      "file.html",
      {
        download: async () => 7,
        search: async () => {
          controller.abort();
          return [{ state: "in_progress" }];
        },
        cancel: async (id) => {
          canceled = id;
        },
      },
      {
        signal: controller.signal,
        progress: (value) => states.push(value.phase),
        makeUrl: () => "blob:test",
        revoke: () => {},
        wait: async () => {},
      },
    ),
    /Export canceled/,
  );
  assert.equal(canceled, 7);
  assert.deepEqual(states, ["save-dialog", "downloading"]);
});
