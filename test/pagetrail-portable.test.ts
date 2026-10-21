// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildLearningExport,
  safeLearningAsset,
  type LearningDocument,
} from "../src/pagetrail/portable.ts";
const bytes = (s: string) => new TextEncoder().encode(s);
const decode = (value: Uint8Array | undefined) =>
  new TextDecoder().decode(value);
const doc = (
  html: string,
  overrides: Partial<LearningDocument> = {},
): LearningDocument => ({
  id: "one",
  title: "Sample lesson",
  url: "https://sample.test/course",
  capture: "Capture 1",
  time: "2026-10-19T12:00:00Z",
  html,
  ...overrides,
});
const build = (
  documents: LearningDocument[],
  resolveAsset = async (_doc: LearningDocument, _url: string) => null as any,
) =>
  buildLearningExport({
    title: "Learning sample",
    documents,
    coverage: "Coverage unknown",
    resolveAsset,
  });
test("learning package preserves semantic structure, Unicode and literal code", async () => {
  const result = await build([
    doc(
      "<h1>Inspect</h1><p>Use <strong>correct tools</strong>.</p><ol><li>First step</li><li>Second step<ul><li>Nested check</li></ul></li></ol><table><tr><th>Tool</th><th>Check</th></tr><tr><td>A</td><td>café · हिन्दी · 日本語</td></tr></table><pre><code>if (x &lt; 2) {\n  run(```);\n}</code></pre><blockquote>Verify first.</blockquote>",
    ),
  ]);
  const md = decode(result.files.get(result.manifest.outputs.notes));
  assert.match(md, /### Inspect/);
  assert.match(md, /\*\*correct tools\*\*/);
  assert.match(md, /1\. First step/);
  assert.match(md, /2\. Second step/);
  assert.match(md, /\| Tool \| Check \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /café · हिन्दी · 日本語/);
  assert.match(md, /````\nif \(x < 2\) \{\n  run\(```\);/);
  assert.match(md, /> Verify first/);
  assert.match(decode(result.files.get("index.html")), /<table>/);
});
test("same-URL capture changes and separate frames retain provenance", async () => {
  const result = await build([
    doc("<h1>State one</h1><p>Before disconnecting</p>"),
    doc("<h1>State two</h1><p>After reconnecting</p>", {
      id: "two",
      capture: "Capture 2",
    }),
    doc("<p>Embedded lesson text</p>", {
      id: "frame",
      url: "https://content.test/frame",
    }),
  ]);
  assert.equal(result.manifest.documents.length, 3);
  const content = decode(result.files.get(result.manifest.outputs.notes));
  assert.match(content, /Before disconnecting/);
  assert.match(content, /After reconnecting/);
  assert.match(content, /Embedded lesson text/);
  assert.match(content, /Sample lesson · Capture 2/);
  assert.equal(result.manifest.notesValidated, false);
  assert.equal(result.manifest.completionStatus, "unknown");
});
test("scripts, form values and hidden secrets cannot leak into notes or revision excerpts", async () => {
  const result = await build([
    doc(
      '<h1>Safe title<span hidden>SECRET_HEADING</span></h1><p>Visible<script>SECRET_SCRIPT</script><span style="display:none">SECRET_STYLE</span><input value="SECRET_INPUT"><span aria-hidden="true">SECRET_ARIA</span></p><form>SECRET_FORM</form><table><tr hidden><td>SECRET_ROW</td></tr><tbody hidden><tr><td>SECRET_BODY</td></tr></tbody></table><img src="https://missing.test/a.png" onerror="SECRET_EVENT" alt="missing"><a href="javascript:SECRET_LINK">Read</a>',
    ),
  ]);
  for (const name of [
    result.manifest.outputs.notes,
    result.manifest.outputs.revision,
    result.manifest.outputs.reader,
  ])
    assert(!decode(result.files.get(name)).includes("SECRET_"), name);
  const html = decode(result.files.get("index.html"));
  assert(!html.includes("<script"));
  assert(!html.includes("onerror="));
  assert.match(html, /default-src 'none'/);
  assert(result.missing > 0);
});
test("saved images and PDFs are deduplicated, linked locally, embedded in reading HTML and hashed", async () => {
  const png = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const pdf = bytes("%PDF-1.4\nfixture bytes\n%%EOF");
  const result = await build(
    [
      doc('<img src="/image.png" alt="Diagram"><a href="/guide.pdf">Guide</a>'),
      doc('<img src="/image.png" alt="Same diagram">', {
        id: "two",
        capture: "Capture 2",
      }),
    ],
    async (_, url) => ({
      mime: url.endsWith("pdf") ? "application/pdf" : "image/png",
      bytes: url.endsWith("pdf") ? pdf : png,
    }),
  );
  assert.equal(result.manifest.assets.length, 2);
  const html = decode(result.files.get("index.html"));
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /href="data:application\/pdf;base64,/);
  assert(!html.includes('src="assets/'));
  assert.match(
    decode(result.files.get(result.manifest.outputs.notes)),
    /saved attachment: `assets\/[a-f0-9]{64}\.pdf`/,
  );
  assert.doesNotMatch(
    decode(result.files.get(result.manifest.outputs.notes)),
    /\]\(assets\/[a-f0-9]{64}\.pdf\)/,
  );
  for (const file of result.manifest.files) {
    const data = result.files.get(file.path)!;
    assert.equal(file.bytes, data.length);
    assert.equal(file.sha256, createHash("sha256").update(data).digest("hex"));
  }
  assert.equal(new Uint8Array(await result.blob.arrayBuffer())[0], 80); // ZIP signature
});
test("SVG attachments are inert even when opened as separate files", async () => {
  const asset = await safeLearningAsset({
    mime: "image/svg+xml",
    bytes: bytes(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="attack()"><script>BAD_SCRIPT</script><foreignObject>BAD_HTML</foreignObject><image href="https://remote.test/a"/><rect width="20" height="20" fill="url(https://remote.test/a)"/><path d="M0 0L10 10" stroke="green"/></svg>',
    ),
  });
  assert(asset);
  const svg = decode(asset.bytes);
  assert(!/script|onload|foreignObject|https:|BAD_/.test(svg));
  assert.match(svg, /<path/);
  assert.equal(
    await safeLearningAsset({
      mime: "image/png",
      bytes: bytes("<html>not an image</html>"),
    }),
    null,
  );
});
test("internal source links resolve locally and missing attachments stay explicit", async () => {
  const result = await build([
    doc(
      '<a href="/second">Next</a><img src="/missing.png" alt="Missing diagram">',
    ),
    doc("<p>Second source</p>", {
      id: "two",
      url: "https://sample.test/second",
    }),
  ]);
  const notes = decode(result.files.get(result.manifest.outputs.notes));
  assert.match(notes, /Next _\(captured section: Sample lesson · Capture 1\)_/);
  assert.doesNotMatch(notes, /#page-0002/);
  assert.match(notes, /Image unavailable/);
  assert.match(result.manifest.warnings.join(" "), /attachment missing/);
});
test("plain-text fallback and DOM-only text remain labelled and preserved", async () => {
  const result = await build([
    doc("", { text: "DOM_ONLY_TEXT" }),
    doc("<p>Saved server HTML</p>", { id: "two", text: "NEW_DYNAMIC_TEXT" }),
  ]);
  const notes = decode(result.files.get(result.manifest.outputs.notes));
  assert.match(notes, /DOM\\_ONLY\\_TEXT/);
  assert.match(notes, /NEW\\_DYNAMIC\\_TEXT/);
  assert(result.manifest.warnings.some((w) => w.includes("text-only")));
  assert.match(
    decode(result.files.get(result.manifest.outputs.revision)),
    /not a complete summary/,
  );
});
test("portable export rejects empty and oversized source input without reading attachments", async () => {
  await assert.rejects(build([]));
  await assert.rejects(build([doc("a".repeat(10 * 1024 * 1024 + 1))]), /10 MB/);
});
test("nested lists render once per subtree rather than exhausting the node budget", async () => {
  const html =
    "<ul><li>Layer".repeat(24) + "Deep content" + "</li></ul>".repeat(24);
  const result = await build([doc(html)]);
  assert.match(
    decode(result.files.get(result.manifest.outputs.notes)),
    /Deep content/,
  );
});
test("inline code preserves literal Markdown punctuation and backticks", async () => {
  const result = await build([
    doc("<p>Run <code>foo_bar(`x`) &lt; 2 &amp;&amp; *y</code>.</p>"),
  ]);
  assert.match(
    decode(result.files.get(result.manifest.outputs.notes)),
    /`` foo_bar\(`x`\) < 2 && \*y ``/,
  );
});
test("notes-app files have descriptive names and no false anchor links", async () => {
  const result = await build([doc("<h1>First</h1><p>Source text</p>")]);
  assert.match(
    result.manifest.outputs.notes,
    /^PageTrail - Learning sample - Detailed notes\.md$/,
  );
  assert.match(result.manifest.outputs.revision, /Quick revision\.md$/);
  assert(result.files.has("README.txt"));
  assert(!result.files.has("README.md"));
  const notes = decode(result.files.get(result.manifest.outputs.notes));
  const revision = decode(result.files.get(result.manifest.outputs.revision));
  assert.doesNotMatch(notes + revision, /\]\([^)]*#page-/);
  assert.match(revision, /Detailed source: \*\*Sample lesson · Capture 1\*\*/);
});
