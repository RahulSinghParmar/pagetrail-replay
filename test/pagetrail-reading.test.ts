// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectReadingBook,
  textFromHtml,
  readingHtml,
  readingMarkdown,
} from "../src/pagetrail/reading.ts";
test("inert HTML extraction keeps Unicode and excludes executable/private controls", () => {
  const text = textFromHtml(
    '<title>Secret title</title><h1>Tools</h1><p>हिन्दी &amp; café</p><script>fetch("https://evil.test")</script><style>hidden</style><input value="secret"><p hidden>secret</p><iframe src="https://evil.test"></iframe>',
  );
  assert.match(text, /Tools/);
  assert.match(text, /हिन्दी & café/);
  assert(!text.includes("secret"));
  assert(!text.includes("fetch"));
  assert(!text.includes("evil"));
});
test("one reading section per exact URL merges repeat visits without dropping query routes", async () => {
  const book = await collectReadingBook(
    "Demo",
    [
      {
        url: "https://learn.test/?unit=1",
        text: "Common\nFirst lesson",
        ts: 1,
      },
      {
        url: "https://learn.test/?unit=1",
        text: "Common\nFirst lesson\nNewly revealed text",
        ts: 2,
      },
      { url: "https://learn.test/?unit=2", text: "Second lesson", ts: 3 },
    ],
    async () => null,
  );
  assert.equal(book.sections.length, 2);
  assert.equal(book.sections[0].captures, 2);
  assert.equal(book.sections[0].text.split("Common").length, 2);
  assert.match(book.sections[0].text, /Newly revealed/);
});
test("HTML fallback and missing coverage are visible; empty exports fail instead of pretending", async () => {
  const book = await collectReadingBook(
    "Fallback",
    [{ url: "https://learn.test/a" }, { url: "https://learn.test/b" }],
    async (page) =>
      page.url.endsWith("a") ? "<h1>Saved HTML lesson</h1>" : null,
  );
  assert(book.sections[0].fallback);
  assert.equal(book.missing.length, 1);
  assert.match(readingHtml(book), /Coverage warning/);
  assert.match(readingMarkdown(book), /Coverage warning/);
  await assert.rejects(
    collectReadingBook(
      "Empty",
      [{ url: "https://learn.test/" }],
      async () => null,
    ),
    /No readable text/,
  );
});
test("single HTML is inert and Markdown escapes source HTML and strips URL credentials", async () => {
  const book = await collectReadingBook(
    "<img src=x onerror=alert(1)>",
    [
      {
        title: "<script>alert(1)</script>",
        url: "https://user:password@learn.test/a",
        text: "<script>bad()</script>\n# Untrusted heading",
      },
    ],
    async () => null,
  );
  const html = readingHtml(book),
    md = readingMarkdown(book);
  assert(html.startsWith("<!doctype html>"));
  assert(!html.includes("<script>"));
  assert(!html.includes("onerror=alert(1)>"));
  assert.match(html, /default-src 'none'/);
  assert.match(html, /href="#page-1"/);
  assert(!html.includes("user:password"));
  assert(!md.includes("<script>"));
  assert.match(md, /\\# Untrusted/);
});
