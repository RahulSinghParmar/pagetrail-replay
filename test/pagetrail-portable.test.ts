// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildLearningExport,
  safeLearningAsset,
  type LearningDocument,
} from "../src/pagetrail/portable.ts";
import { organizeLearningDocuments } from "../src/pagetrail/learning-organize.ts";
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
  assert.match(content, /Capture 2/);
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
test("saved images and PDFs are deduplicated, linked locally once and hashed", async () => {
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
  assert.match(html, /src="assets\/[a-f0-9]{64}\.png"/);
  assert.match(html, /href="assets\/[a-f0-9]{64}\.pdf"/);
  assert.doesNotMatch(html, /base64,/);
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

test("oversized media cannot inflate a notes-app package", async () => {
  const oversizedGif = new Uint8Array(6 * 1024 * 1024);
  oversizedGif.set(new TextEncoder().encode("GIF89a"));
  const result = await build(
    [doc('<h1>Animation</h1><img src="/large.gif" alt="Large animation">')],
    async () => ({ mime: "image/gif", bytes: oversizedGif }),
  );
  assert.equal(result.manifest.assets.length, 0);
  assert.match(
    result.manifest.warnings.join(" "),
    /asset omitted from the notes package because it exceeds 5 MB/,
  );
  assert.match(
    decode(result.files.get(result.manifest.outputs.notes)),
    /Image unavailable — omitted from the notes package; original remains in the source archive: Large animation/,
  );
  assert(new Uint8Array(await result.blob.arrayBuffer()).length < 100_000);
});
test("large raster images are optimized before consuming the notes media budget", async (t) => {
  const bitmapDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  const canvasDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "OffscreenCanvas",
  );
  t.after(() => {
    if (bitmapDescriptor)
      Object.defineProperty(globalThis, "createImageBitmap", bitmapDescriptor);
    else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    if (canvasDescriptor)
      Object.defineProperty(globalThis, "OffscreenCanvas", canvasDescriptor);
    else delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 1800, height: 1000, close() {} }),
  });
  const compactWebp = new Uint8Array(80_000);
  compactWebp.set(bytes("RIFF"), 0);
  compactWebp.set(bytes("WEBP"), 8);
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value: class {
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob() {
        return new Blob([compactWebp], { type: "image/webp" });
      }
    },
  });
  const largePng = new Uint8Array(900_000);
  largePng.set(new Uint8Array([137, 80, 78, 71]));
  const result = await build(
    [doc('<h1>Diagram</h1><img src="/large.png" alt="Process diagram">')],
    async () => ({ mime: "image/png", bytes: largePng }),
  );
  assert.equal(result.manifest.assets.length, 1);
  assert.equal(result.manifest.assets[0].mime, "image/webp");
  assert.equal(result.manifest.media.optimizedAssets, 1);
  assert.equal(result.manifest.media.optimizedInputBytes, largePng.length);
  assert.equal(result.manifest.media.optimizedOutputBytes, compactWebp.length);
  assert.equal(result.manifest.media.omittedReferences, 0);
  assert.match(
    decode(result.files.get(result.manifest.outputs.notes)),
    /optimized \*\*1\*\* large raster image/,
  );
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
  assert.match(notes, /Image unavailable — not captured/);
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
    /Review points selected mechanically/,
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
  assert.match(revision, /Detailed source: \*\*PageTrail - Learning sample - Detailed notes\*\*/);
});

test("learning organizer removes player shells and consolidates repeated lesson states", () => {
  const documents: LearningDocument[] = [
    doc('<iframe src="/player"></iframe><p>Loading course</p>', {
      id: "shell-one",
      title: "Learning portal",
      url: "https://learning.test/launch?token=secret",
    }),
    doc(
      '<main class="lesson-main"><h1>Lesson one</h1><p>Short explanation for the first lesson.</p></main><nav><a href="/one">Duplicate navigation</a></nav>',
      {
        id: "lesson-one-short",
        title: "Learning portal · Embedded document 2",
        url: "https://content.test/course#/lessons/one",
      },
    ),
    doc(
      '<main class="lesson-main"><h1>Lesson one</h1><p>Longer explanation for the first lesson with the useful procedure.</p><ol><li>First action</li><li>Second action</li></ol></main><nav><a href="/one">Duplicate navigation</a></nav>',
      {
        id: "lesson-one-rich",
        title: "Learning portal · Embedded document 2",
        url: "https://content.test/course#/lessons/one",
        capture: "Capture 2",
      },
    ),
    doc(
      '<html><head><title>Lesson one - Example Course</title></head><body><main class="lesson-main"><h1>Lesson one</h1><p>This is a longer transient view left behind while the second route is loading, and it must not replace the settled lesson.</p></main></body></html>',
      {
        id: "lesson-two-transition",
        title: "Learning portal · Embedded document 2",
        url: "https://content.test/course#/lessons/two",
        capture: "Capture 3",
      },
    ),
    doc(
      '<html><head><title>Lesson two - Example Course</title></head><body><main class="lesson-main"><h1>Lesson two</h1><p>Second lesson explanation is retained.</p></main></body></html>',
      {
        id: "lesson-two",
        title: "Learning portal · Embedded document 2",
        url: "https://content.test/course#/lessons/two",
        capture: "Capture 4",
      },
    ),
    doc(
      '<html><head><title>Lesson one - Example Course</title></head><body><main class="lesson-main"><h1>Lesson one</h1><p>Longer explanation for the first lesson with the useful procedure.</p><ol><li>First action</li><li>Second action</li></ol></main></body></html>',
      {
        id: "lesson-one-title",
        title: "Learning portal · Embedded document 2",
        url: "https://content.test/course#/lessons/one",
        capture: "Capture 5",
      },
    ),
  ];
  const result = organizeLearningDocuments(documents);
  assert.equal(result.documents.length, 2);
  assert.equal(result.suggestedTitle, "Example Course");
  assert.equal(result.stats.inputDocuments, 6);
  assert.equal(result.stats.outputSections, 2);
  assert.equal(result.stats.omittedShells, 1);
  assert.equal(result.stats.consolidatedDuplicates, 3);
  assert.equal(result.stats.excludedOutOfScope, 0);
  assert.equal(result.documents[0].title, "Lesson one");
  assert.match(result.documents[0].html || "", /useful procedure/);
  assert.doesNotMatch(result.documents[0].html || "", /Duplicate navigation/);
  assert.equal(result.documents[1].title, "Lesson two");
  assert.doesNotMatch(result.documents[1].html || "", /transient view/);
});

test("learning organizer keeps the dominant course scope and reports unvisited outline sections", () => {
  const course = "https://content.test/course/index.html";
  const navigation = `<nav><a href="${course}#/lessons/one">Lesson one Completed</a><a href="${course}#/lessons/resources">Resources Completed</a><a href="${course}#/lessons/complete">Training Complete Completed</a></nav>`;
  const documents: LearningDocument[] = [
    doc(
      `<html><head><title>Lesson one - Example Course</title></head><body>${navigation}<main><h1>Lesson one</h1><p>Useful lesson content that was fully captured.</p></main></body></html>`,
      { id: "one", url: `${course}#/lessons/one` },
    ),
    doc(
      `<html><head><title>Training Complete - Example Course</title></head><body>${navigation}<main><h1>Training Complete</h1><p>The final course page was captured.</p></main></body></html>`,
      { id: "complete", url: `${course}#/lessons/complete` },
    ),
    doc(
      "<main><h1>Learning portal</h1><p>This unrelated catalogue contains lots of valid-looking text that must not enter course notes.</p></main>",
      {
        id: "portal",
        title: "Learning portal",
        url: "https://learning.test/catalogue",
      },
    ),
  ];
  const result = organizeLearningDocuments(documents);
  assert.deepEqual(
    result.documents.map((item) => item.id),
    ["one", "complete"],
  );
  assert.equal(result.stats.excludedOutOfScope, 1);
  assert.equal(result.stats.detectedOutlineItems, 3);
  assert.equal(result.stats.capturedOutlineItems, 2);
  assert.equal(result.stats.missingOutlineItems, 1);
  assert.equal(result.missingOutline[0]?.title, "Resources");
  assert.match(result.missingOutline[0]?.url || "", /#\/lessons\/resources$/);
});

test("course links alone do not erase an ordinary captured page", () => {
  const result = organizeLearningDocuments([
    doc(
      '<main><h1>Training catalogue</h1><p>This ordinary page remains readable when no lesson pages were captured.</p><a href="https://content.test/course#/lessons/one">Lesson one</a><a href="https://content.test/course#/lessons/two">Lesson two</a></main>',
      { id: "catalogue", url: "https://learning.test/catalogue" },
    ),
  ]);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].id, "catalogue");
  assert.equal(result.stats.excludedOutOfScope, 0);
  assert.equal(result.stats.detectedOutlineItems, 0);
});

test("organized notes keep technical warnings in the manifest instead of flooding study notes", async () => {
  const result = await buildLearningExport({
    title: "Example Course",
    documents: [
      doc("<main><h1>Lesson</h1><p>A useful learning point with enough context.</p></main>"),
    ],
    coverage: "One captured source",
    warnings: Array.from({ length: 20 }, (_, index) => `warning ${index}`),
    organization: {
      inputDocuments: 30,
      outputSections: 1,
      omittedShells: 9,
      consolidatedDuplicates: 20,
    },
    resolveAsset: async () => null,
  });
  const notes = decode(result.files.get(result.manifest.outputs.notes));
  assert.match(notes, /Organized \*\*30\*\* captured documents into \*\*1\*\*/);
  assert.match(notes, /20 technical warnings recorded in `manifest\.json`/);
  assert.doesNotMatch(notes, /warning 19/);
  assert.equal(result.manifest.warnings.length, 20);
  assert.equal(result.manifest.schema, "pagetrail.learning.v2");
});
