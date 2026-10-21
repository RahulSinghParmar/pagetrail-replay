// SPDX-License-Identifier: AGPL-3.0-or-later
// Run after make-affine-fixture.py. Uses the production portable exporter.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildLearningExport } from "../src/pagetrail/portable.ts";

const root = "test/artifacts/affine-validation";
const label = "PageTrail Test — Synthetic Content";
const result = await buildLearningExport({
  title: label,
  coverage:
    "Invented acceptance fixture only. No actual website/course was recorded.",
  documents: [
    {
      id: "synthetic-one",
      title: label + " · Format checks",
      url: "https://example.invalid/pagetrail-test/lesson-one",
      capture: "Synthetic capture 1",
      time: "2026-10-20T09:00:00Z",
      html: `<h1>Heading check: Synthetic lesson</h1>
<p>Paragraph with <strong>bold emphasis</strong>, <em>italic emphasis</em> and Unicode: café · हिन्दी · 日本語.</p>
<h2>Lists</h2><ol><li>First synthetic step</li><li>Second synthetic step<ul><li>Nested check 042</li></ul></li></ol>
<h2>Table</h2><table><tr><th>Item</th><th>Expected</th></tr><tr><td>Sample A</td><td>42 units</td></tr><tr><td>Sample B</td><td>Ready</td></tr></table>
<h2>Code</h2><pre><code>const sample_id = "PT-042";\nif (count &lt; 2) {\n  show(sample_id);\n}</code></pre><p>Inline literal: <code>foo_bar(&#96;x&#96;) &lt; 2</code></p>
<h2>Images and attachment</h2><img src="/diagram.png" alt="PageTrail synthetic PNG diagram"><img src="/diagram.svg" alt="PageTrail synthetic SVG diagram">
<p><a href="/reference.pdf">Synthetic reference PDF (PT-ATTACHMENT-042)</a></p>
<blockquote>Everything in this document is invented for import validation.</blockquote>
<p><a href="/pagetrail-test/lesson-two">Go to second captured source</a></p>`,
    },
    {
      id: "synthetic-two",
      title: label + " · Revision destination",
      url: "https://example.invalid/pagetrail-test/lesson-two",
      capture: "Synthetic capture 2",
      time: "2026-10-20T09:01:00Z",
      html: "<h1>Revision destination</h1><p>Destination marker PT-REVISION-042.</p><ul><li>Compare the source before trusting a revision excerpt.</li></ul>",
    },
  ],
  resolveAsset: async (_doc, url) => {
    if (url.endsWith("diagram.png"))
      return {
        mime: "image/png",
        bytes: await readFile(root + "/synthetic-diagram.png"),
      };
    if (url.endsWith("reference.pdf"))
      return {
        mime: "application/pdf",
        bytes: await readFile(root + "/synthetic-reference.pdf"),
      };
    if (url.endsWith("diagram.svg"))
      return {
        mime: "image/svg+xml",
        bytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100" viewBox="0 0 360 100"><rect width="360" height="100" fill="#edf4ef"/><circle cx="50" cy="50" r="25" fill="#21624c"/><text x="95" y="55" font-size="18">Synthetic SVG 042</text></svg>',
        ),
      };
    return null;
  },
});
const output = root + "/package";
await mkdir(output, { recursive: true });
for (const [name, bytes] of result.files) {
  if (name.startsWith("assets/"))
    await mkdir(output + "/assets", { recursive: true });
  await writeFile(output + "/" + name, bytes);
}
await writeFile(
  root + "/PageTrail-Test-Synthetic-Content.zip",
  new Uint8Array(await result.blob.arrayBuffer()),
);
console.log(
  JSON.stringify({
    bytes: result.blob.size,
    documents: result.manifest.documents.length,
    assets: result.manifest.assets.length,
    warnings: result.manifest.warnings,
  }),
);
