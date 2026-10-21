// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import {
  allowReplayRequest,
  localArchiveSource,
  REPLAY_CSP,
  localImportOptions,
  localCollectionId,
} from "../src/pagetrail/replay-policy.ts";
const prefix = "http://127.0.0.1:4175/";
test("reader accepts same-origin archives, never remote or non-archive URLs", () => {
  for (const source of [
    "/demo.wacz",
    "one.warc.gz",
    "/one.har",
    "/one.wacz.zip",
    "file://local recording.wacz",
    "local://abcdefghijklmnop12345678",
  ])
    assert.equal(localArchiveSource(source, prefix), true);
  for (const source of [
    "https://example.com/private.wacz",
    "http://127.0.0.1:4176/demo.wacz",
    "//example.com/a.wacz",
    "javascript:alert(1)",
    "data:text/plain,secret.wacz",
    "/index.html",
    "http://user:pass@127.0.0.1:4175/a.wacz",
    "local://abcdefghijklmnop12345678/path",
    "local://user:secret@abcdefghijklmnop12345678",
    "local://abcdefghijklmnop12345678?config=live",
  ])
    assert.equal(localArchiveSource(source, prefix), false);
});
test("local picker imports all resources into independent collections", () => {
  const first = localImportOptions(),
    second = localImportOptions();
  assert.equal(first.newFullImport, true);
  assert.equal(second.newFullImport, true);
  assert.notEqual(first.customColl, second.customColl);
  assert.match(first.customColl, /^import-[a-f0-9-]{36}$/);
  assert(!("importCollId" in first));
});
test("full-import identities reopen their native collection rather than hashing the URL", () => {
  assert.equal(
    localCollectionId("local://abcdefghijklmnop12345678"),
    "abcdefghijklmnop12345678",
  );
  for (const source of [
    "local://abc",
    "local://abcdefghijklmnop12345678/path",
    "local://abcdefghijklmnop12345678?live=1",
    "https://example.com/demo.wacz",
    "file://demo.wacz",
  ])
    assert.equal(localCollectionId(source), null);
});
test("archive requests cannot reach live web or reader control API", () => {
  for (const url of [
    prefix + "w/c/20260101mp_/https://example.com/",
    prefix + "static/wombat.js",
  ])
    assert.equal(allowReplayRequest(url, true, prefix), true);
  for (const url of [
    "https://example.com/",
    "http://127.0.0.1:4176/",
    prefix + "w/api/c",
    prefix + "demo.wacz",
    prefix + "index.html",
    prefix + "static/proxy/https://example.com/",
  ])
    assert.equal(allowReplayRequest(url, true, prefix), false);
  assert.equal(allowReplayRequest(prefix + "w/api/c", false, prefix), true);
});
test("read-only replay disables forms, popups, workers and live websockets", () => {
  assert.match(REPLAY_CSP, /connect-src 'self';/);
  assert.match(REPLAY_CSP, /form-action 'none'/);
  assert.match(REPLAY_CSP, /worker-src 'none'/);
  assert.match(REPLAY_CSP, /sandbox allow-scripts allow-same-origin$/);
  assert.doesNotMatch(
    REPLAY_CSP,
    /allow-popups|allow-top-navigation|allow-forms|wss?:/,
  );
});
