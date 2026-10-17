// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { WARCParser } from "warcio";
const file = "test/fixtures/interactive-demo.wacz";
const entry = (path: string) =>
  execFileSync("unzip", ["-p", file, path], { maxBuffer: 4 * 1024 * 1024 });
test("native WACZ has valid resource hashes, page list and URL index", () => {
  const data = entry("datapackage.json");
  const pack = JSON.parse(data.toString());
  assert.equal(pack.wacz_version, "1.1.1");
  for (const resource of pack.resources) {
    const bytes = entry(resource.path);
    assert.equal(bytes.length, resource.bytes);
    assert.equal(
      "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      resource.hash,
    );
  }
  const digest = JSON.parse(entry("datapackage-digest.json").toString());
  assert.equal(
    digest.hash,
    "sha256:" + createHash("sha256").update(data).digest("hex"),
  );
  const pages = entry("pages/pages.jsonl")
    .toString()
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => JSON.parse(line));
  assert.equal(pages.length, 3);
  assert(pages.some((page) => page.url.endsWith("/lesson?unit=tools")));
  assert(
    entry("indexes/index.cdx").toString().includes("/api/lesson?unit=cables"),
  );
});
test("archive retains original scripts, links, frames and distinct API responses", async () => {
  async function* chunks() {
    yield new Uint8Array(entry("archive/data.warc.gz"));
  }
  const responses = new Map<string, string>();
  const revisits: [string, string][] = [];
  for await (const record of new WARCParser(chunks())) {
    const body = await record.contentText();
    if (record.warcType === "response")
      responses.set(record.warcTargetURI!, body);
    if (record.warcType === "revisit")
      revisits.push([
        record.warcTargetURI!,
        record.warcHeader("WARC-Refers-To-Target-URI")!,
      ]);
  }
  for (const [url, target] of revisits)
    responses.set(url, responses.get(target)!);
  const base = "http://127.0.0.1:4176";
  assert.equal(responses.size, 9);
  assert.equal(revisits.length, 2); // Identical HTML is referenced, not copied again.
  assert(responses.get(base + "/")?.includes('href="/lesson?unit=tools"'));
  assert(responses.get(base + "/")?.includes('<script defer src="/app.js"'));
  assert(
    responses.get(base + "/app.js")?.includes('fetch("/api/lesson?unit="'),
  );
  assert(responses.get(base + "/embedded")?.includes("FRAME-REPLAY-CHECK"));
  assert.match(
    responses.get(base + "/api/lesson?unit=tools")!,
    /Tools: inspect/,
  );
  assert.match(
    responses.get(base + "/api/lesson?unit=cables")!,
    /Cables: identify/,
  );
  assert(!responses.has(base + "/never-captured"));
});
