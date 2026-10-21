// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionController,
  inScope,
  type Session,
} from "../src/pagetrail/session.ts";
import { cleanHeaders, sensitiveEndpoint } from "../src/pagetrail/privacy.ts";

function setup(restored: Session | null = null) {
  let stored = restored,
    url = "https://learn.example.test/course?a=1",
    attachFail = false,
    stopFail = false;
  const attached: string[] = [],
    stopped: string[] = [],
    created: string[] = [];
  const ctrl = createSessionController({
    load: async () => stored,
    save: async (session) => {
      stored = structuredClone(session);
    },
    tab: async (id) => ({ id, url, title: "Completed course" }),
    create: async (title) => {
      created.push(title);
      return "archive-" + created.length;
    },
    attach: async (session) => {
      if (attachFail) throw new Error("debugger in use");
      attached.push(session.id);
    },
    detach: async (session) => {
      if (stopFail) throw new Error("flush failed");
      if (attached.length > stopped.length) stopped.push(session.id);
    },
    now: () => "2026-10-16T18:00:00Z",
  });
  return {
    ctrl,
    attached,
    stopped,
    created,
    setUrl: (value: string) => {
      url = value;
    },
    failAttach: () => {
      attachFail = true;
    },
    failStop: () => {
      stopFail = true;
    },
  };
}
const consent = { tabId: 42, acknowledged: true };
test("Start/Pause/Resume/Finish retains one collection, not screen snapshots", async () => {
  const t = setup();
  assert.equal((await t.ctrl.command("start", consent))?.state, "RECORDING");
  assert.equal((await t.ctrl.command("pause"))?.state, "PAUSED");
  assert.equal((await t.ctrl.command("resume"))?.state, "RECORDING");
  assert.equal((await t.ctrl.command("finish"))?.state, "STOPPED");
  assert.deepEqual(t.attached, ["archive-1", "archive-1"]);
  assert.deepEqual(t.stopped, ["archive-1", "archive-1"]);
  assert.equal(t.created.length, 1);
  assert(!("snapshots" in (await t.ctrl.status())!));
});
test("consent and normal site are required before any collection is created", async () => {
  const t = setup();
  await assert.rejects(t.ctrl.command("start", { tabId: 42 }), /Confirm/);
  t.setUrl("chrome://settings");
  await assert.rejects(t.ctrl.command("start", consent), /HTTP/);
  t.setUrl("https://user:password@example.test/");
  await assert.rejects(t.ctrl.command("start", consent), /credentials/);
  assert.equal(t.created.length, 0);
});
test("recording outside the originating site pauses, other tabs do not affect it", async () => {
  const t = setup();
  await t.ctrl.command("start", consent);
  await t.ctrl.navigated(99, "https://outside.test/");
  assert.equal(t.stopped.length, 0);
  await t.ctrl.navigated(42, "https://learn.example.test/another-lesson");
  assert.equal(t.stopped.length, 0);
  await t.ctrl.navigated(42, "https://outside.test/");
  assert.equal((await t.ctrl.status())?.state, "PAUSED");
  t.setUrl("https://outside.test/");
  await assert.rejects(t.ctrl.command("resume"), /original site/);
});
test("browser restart pauses, preserves archive ID and requires explicit Resume", async () => {
  const t = setup();
  const original = await t.ctrl.command("start", consent);
  const restarted = setup(original);
  assert.equal((await restarted.ctrl.status())?.state, "PAUSED");
  assert.equal(restarted.attached.length, 0);
  await restarted.ctrl.command("resume");
  assert.deepEqual(restarted.attached, ["archive-1"]);
});
test("attachment failure is visible and preserves a recoverable archive", async () => {
  const t = setup();
  t.failAttach();
  await assert.rejects(t.ctrl.command("start", consent), /connect/);
  assert.equal((await t.ctrl.status())?.state, "PAUSED");
  assert.equal((await t.ctrl.status())?.id, "archive-1");
});
test("failed finish never falsely reports STOPPED or deletes the archive", async () => {
  const t = setup();
  await t.ctrl.command("start", consent);
  t.failStop();
  await assert.rejects(t.ctrl.command("finish"), /finish recording cleanly/);
  assert.equal((await t.ctrl.status())?.state, "ERROR");
  assert.equal((await t.ctrl.status())?.id, "archive-1");
  await assert.rejects(t.ctrl.command("start", consent), /Finish/);
});
test("serialized actions prevent concurrent starts and preserve older collections", async () => {
  const t = setup();
  const result = await Promise.allSettled([
    t.ctrl.command("start", consent),
    t.ctrl.command("start", consent),
  ]);
  assert.deepEqual(
    result.map((item) => item.status),
    ["fulfilled", "rejected"],
  );
  await t.ctrl.command("finish");
  await t.ctrl.command("start", consent);
  assert.equal(t.created.length, 2);
  assert.equal((await t.ctrl.status())?.id, "archive-2");
});
test("finishing a paused session does not attach or capture additional resources", async () => {
  const t = setup();
  await t.ctrl.command("start", consent);
  await t.ctrl.command("pause");
  await t.ctrl.command("finish");
  assert.equal(t.attached.length, 1);
  assert.equal(t.stopped.length, 1);
});
test("unexpected disconnect pauses but does not affect unrelated tabs", async () => {
  const t = setup();
  await t.ctrl.command("start", consent);
  await t.ctrl.interrupted(99);
  assert.equal((await t.ctrl.status())?.state, "RECORDING");
  await t.ctrl.interrupted(42);
  assert.equal((await t.ctrl.status())?.state, "PAUSED");
});
test("site scope does not accept suffix attacks, credentials protocol or other ports", () => {
  for (const url of [
    "https://learn.example.test.evil.test",
    "http://learn.example.test",
    "https://learn.example.test:8443",
    "https://secret@learn.example.test",
    "javascript:alert(1)",
    "https://sibling.example.test",
    "https://child.learn.example.test/path?unit=2#tab",
  ])
    assert(!inScope("https://learn.example.test", url));
  assert(
    inScope(
      "https://learn.example.test",
      "https://learn.example.test/path?unit=2#tab",
    ),
  );
});
test("optional path validates before creating an archive and survives pause/resume", async () => {
  const t = setup();
  await assert.rejects(
    t.ctrl.command("start", { ...consent, pathPrefix: "/other" }),
    /outside/,
  );
  await assert.rejects(
    t.ctrl.command("start", { ...consent, pathPrefix: "/course/../account" }),
    /parent/,
  );
  assert.equal(t.created.length, 0);
  const session = await t.ctrl.command("start", {
    ...consent,
    pathPrefix: "/course/",
  });
  assert.equal(session?.pathPrefix, "/course");
  await t.ctrl.navigated(42, "https://learn.example.test/coursework");
  assert.equal((await t.ctrl.status())?.state, "PAUSED");
  t.setUrl("https://learn.example.test/coursework");
  await assert.rejects(t.ctrl.command("resume"), /original site/);
  t.setUrl("https://learn.example.test/course/lesson?unit=2");
  assert.equal((await t.ctrl.command("resume"))?.state, "RECORDING");
});
test("a nested subdomain is not implicitly authorised for top-level navigation", async () => {
  const t = setup();
  await t.ctrl.command("start", consent);
  await t.ctrl.navigated(42, "https://child.learn.example.test/");
  assert.equal((await t.ctrl.status())?.state, "PAUSED");
});
test("sensitive headers are removed case-insensitively without losing resource MIME", () => {
  const source = {
    Authorization: "Bearer secret",
    Cookie: "secret",
    "Set-Cookie": "secret",
    "X-API-Key": "secret",
    "X-Amz-Security-Token": "secret",
    "Content-Type": "application/json",
    ETag: "123",
  };
  assert.deepEqual(cleanHeaders(source), {
    "Content-Type": "application/json",
    ETag: "123",
  });
  assert(source.Authorization);
  assert.deepEqual(cleanHeaders(null), {});
});
test("authentication resources are excluded but ordinary learning APIs remain recordable", () => {
  for (const url of [
    "https://learn.test/login",
    "https://learn.test/api/token",
    "https://learn.test/oauth2/callback",
    "https://learn.test/logout",
  ])
    assert(sensitiveEndpoint(url));
  assert(!sensitiveEndpoint("https://learn.test/api/lesson?unit=tools"));
});
