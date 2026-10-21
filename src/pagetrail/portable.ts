// SPDX-License-Identifier: AGPL-3.0-or-later
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { downloadZip } from "client-zip";
import { escapeHtml, safeSource } from "./reading";
import { OperationError } from "./operations";
import type { ExportProgress } from "./export-protocol";

export type LearningDocument = {
  id: string;
  title: string;
  url: string;
  capture: string;
  time: string;
  html?: string;
  text?: string;
};
export type LearningAsset = { mime: string; bytes: Uint8Array };
type Node = DefaultTreeAdapterMap["node"];
const e = escapeHtml;
const md = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}[\]()#+!|])/g, "\\$1");
const attr = (n: Node, name: string) =>
  "attrs" in n ? n.attrs.find((a) => a.name === name)?.value || "" : "";
const children = (n: Node) => ("childNodes" in n ? n.childNodes : []);
const plain = (n: Node): string =>
  n.nodeName === "#text" && "value" in n
    ? n.value
    : children(n).map(plain).join("");
const hash = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const encode = (s: string) => new TextEncoder().encode(s);
const absolute = (url: string, base: string) => {
  try {
    return new URL(url, base).href;
  } catch {
    return "";
  }
};
const MAX = 100 * 1024 * 1024;
const portableFilename = (title: string, suffix: string) => {
  const titlePart = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  const clean = /^pagetrail\b/i.test(titlePart)
    ? titlePart
    : "PageTrail - " + (titlePart || "Learning sources");
  return Array.from(clean).slice(0, 100).join("") + " - " + suffix;
};
const SKIP = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "form",
  "input",
  "textarea",
  "select",
  "button",
  "canvas",
  "object",
  "embed",
]);
const invisible = (n: Node) =>
  "tagName" in n &&
  (SKIP.has(n.tagName) ||
    n.attrs.some((a) => a.name === "hidden") ||
    attr(n, "aria-hidden") === "true" ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr(n, "style")));
const visibleText = (n: Node): string =>
  invisible(n)
    ? ""
    : n.nodeName === "#text"
      ? plain(n)
      : children(n).map(visibleText).join("");

// SVG files are rebuilt from inert geometry/text only, including when opened on their own.
function staticSvg(bytes: Uint8Array): Uint8Array {
  const tags = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
  ]);
  const attrs = new Set([
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "transform",
    "font-size",
    "text-anchor",
  ]);
  function render(n: Node): string {
    if (n.nodeName === "#text") return e(plain(n));
    if (!("tagName" in n)) return children(n).map(render).join("");
    if (!tags.has(n.tagName))
      return n.tagName === "html" || n.tagName === "body"
        ? children(n).map(render).join("")
        : "";
    const attributes = n.attrs
      .filter(
        (a) =>
          attrs.has(a.name) &&
          !/url\s*\(|javascript:|data:|https?:|[<>]/i.test(a.value),
      )
      .map((a) => ` ${a.name}="${e(a.value)}"`)
      .join("");
    return `<${n.tagName}${
      n.tagName === "svg" ? ' xmlns="http://www.w3.org/2000/svg"' : ""
    }${attributes}>${children(n).map(render).join("")}</${n.tagName}>`;
  }
  return encode(render(parse(new TextDecoder().decode(bytes))));
}
export function safeLearningAsset(
  asset: LearningAsset,
): (LearningAsset & { extension: string }) | null {
  const bytes = asset.bytes,
    mime = asset.mime.toLowerCase().split(";")[0];
  if (bytes.length > 20 * 1024 * 1024) return null;
  const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 16));
  const valid =
    mime === "image/png"
      ? bytes[0] === 137 && prefix.slice(1, 4) === "PNG"
      : mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === "image/gif"
          ? /^GIF8[79]a/.test(prefix)
          : mime === "image/webp"
            ? prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP"
            : mime === "application/pdf"
              ? prefix.startsWith("%PDF-")
              : false;
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  if (valid) return { bytes, mime, extension: extensions[mime] };
  if (mime === "image/svg+xml") {
    const clean = staticSvg(bytes);
    if (!new TextDecoder().decode(clean).includes("<svg")) return null;
    return { bytes: clean, mime, extension: "svg" };
  }
  return null;
}

export async function buildLearningExport(input: {
  title: string;
  documents: LearningDocument[];
  coverage: string;
  warnings?: string[];
  resolveAsset(
    doc: LearningDocument,
    url: string,
  ): Promise<LearningAsset | null>;
  progress?: (value: ExportProgress) => void;
}) {
  if (!input.documents.length)
    throw new Error("No captured content is available for learning export.");
  if (input.documents.length > 2000)
    throw new OperationError(
      "EXPORT_TOO_LARGE",
      "Too many captured documents.",
    );
  const warnings = [...(input.warnings || [])];
  const files = new Map<string, Uint8Array>();
  const outputs = {
    notes: portableFilename(input.title, "Detailed notes.md"),
    revision: portableFilename(input.title, "Quick revision.md"),
    reader: "index.html",
    instructions: "README.txt",
    manifest: "manifest.json",
  };
  const assets: {
    path: string;
    mime: string;
    bytes: number;
    sha256: string;
  }[] = [];
  const assetUrls = new Map<string, Promise<string | null>>();
  let budget = 0,
    inputBytes = 0,
    nodes = 0;
  const add = (name: string, bytes: Uint8Array) => {
    budget += bytes.length;
    if (budget > MAX)
      throw new OperationError(
        "EXPORT_TOO_LARGE",
        "Learning export exceeds 100 MB.",
      );
    files.set(name, bytes);
  };
  const docs = input.documents.map((doc, i) => ({
    ...doc,
    anchor: "page-" + String(i + 1).padStart(4, "0"),
  }));
  const destinations = new Map<string, (typeof docs)[number]>();
  for (const doc of docs)
    if (!destinations.has(doc.url)) destinations.set(doc.url, doc);
  const attachment = (doc: LearningDocument, url: string) => {
    if (assetUrls.size >= 2000)
      throw new OperationError(
        "EXPORT_TOO_LARGE",
        "Too many attachment references.",
      );
    const key = doc.id + "\n" + url;
    if (!assetUrls.has(key))
      assetUrls.set(
        key,
        (async () => {
          const raw = await input.resolveAsset(doc, url);
          const asset = raw && safeLearningAsset(raw);
          if (!asset) {
            warnings.push(
              `${doc.id}: attachment missing, unsupported or too large: ${
                safeSource(url) || "embedded resource"
              }`,
            );
            return null;
          }
          const digest = await hash(asset.bytes);
          const path = `assets/${digest}.${asset.extension}`;
          if (!files.has(path)) {
            add(path, asset.bytes);
            assets.push({
              path,
              mime: asset.mime,
              bytes: asset.bytes.length,
              sha256: digest,
            });
          }
          return path;
        })(),
      );
    return assetUrls.get(key)!;
  };
  const sections: {
    doc: (typeof docs)[number];
    html: string;
    markdown: string;
    excerpts: string[];
    mode: string;
  }[] = [];
  for (const doc of docs) {
    const sourceBytes =
      encode(doc.html || "").length + encode(doc.text || "").length;
    inputBytes += sourceBytes;
    if (inputBytes > MAX)
      throw new OperationError(
        "EXPORT_TOO_LARGE",
        "Source text exceeds 100 MB.",
      );
    input.progress?.({
      phase: "reading-text",
      done: sections.length,
      total: docs.length,
    });
    if (sourceBytes > 10 * 1024 * 1024)
      throw new OperationError(
        "EXPORT_TOO_LARGE",
        "A learning document exceeds 10 MB.",
      );
    const excerpts: string[] = [];
    const excerpt = (s: string) => {
      const clean = s.replace(/\s+/g, " ").trim();
      if (clean && excerpts.length < 6 && !excerpts.includes(clean))
        excerpts.push(clean.length > 240 ? clean.slice(0, 240) + "…" : clean);
    };
    type Pair = { html: string; markdown: string };
    const combine = (pairs: Pair[]): Pair => ({
      html: pairs.map((p) => p.html).join(""),
      markdown: pairs.map((p) => p.markdown).join(""),
    });
    // Lists and tables need their children's structured results as well as the
    // combined body. Reuse those results instead of revisiting nested subtrees.
    const rendered = new WeakMap<Node, Promise<Pair>>();
    const render = (n: Node): Promise<Pair> => {
      let result = rendered.get(n);
      if (!result) {
        result = renderNode(n);
        rendered.set(n, result);
      }
      return result;
    };
    const renderChildren = async (n: Node) => {
      const pairs: Pair[] = [];
      for (const child of children(n)) pairs.push(await render(child));
      return combine(pairs);
    };
    const renderNode = async (n: Node): Promise<Pair> => {
      if (++nodes > 200000)
        throw new OperationError(
          "EXPORT_TOO_LARGE",
          "Source structure is too large.",
        );
      const blank = { html: "", markdown: "" };
      if (n.nodeName === "#text") {
        const text = plain(n).replace(/\s+/g, " ");
        return { html: e(text), markdown: md(text) };
      }
      if (!("tagName" in n)) return renderChildren(n);
      const tag = n.tagName;
      if (
        SKIP.has(tag) ||
        attr(n, "hidden") ||
        n.attrs.some((a) => a.name === "hidden") ||
        attr(n, "aria-hidden") === "true" ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr(n, "style"))
      )
        return blank;
      if (["iframe", "video", "audio", "svg"].includes(tag)) {
        if (tag !== "iframe")
          warnings.push(
            `${doc.id}: inline ${tag} omitted from reading content.`,
          );
        return {
          html: `<p class="muted">[${
            tag === "iframe"
              ? "Captured frames appear as separate source sections below; uncaptured frames remain unavailable."
              : tag + " not included in reading content"
          }]</p>`,
          markdown: `\n\n[${tag} content is not reproduced inline.]\n\n`,
        };
      }
      if (tag === "img") {
        const url = absolute(attr(n, "src"), doc.url),
          alt = attr(n, "alt") || "Captured image";
        const path = url && (await attachment(doc, url));
        return path
          ? {
              html: `<img src="${path}" alt="${e(alt)}">`,
              markdown: `![${md(alt)}](${path})`,
            }
          : {
              html: `<p>[Image unavailable: ${e(alt)}]</p>`,
              markdown: `[Image unavailable: ${md(alt)}]`,
            };
      }
      if (tag === "pre") {
        const text = visibleText(n);
        const fence = "`".repeat(
          Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
        );
        return {
          html: `<pre><code>${e(text)}</code></pre>`,
          markdown: `\n\n${fence}\n${text}\n${fence}\n\n`,
        };
      }
      if (tag === "code") {
        const text = visibleText(n).replace(/\s+/g, " ");
        const fence = "`".repeat(
          Math.max(1, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
        );
        return {
          html: `<code>${e(text)}</code>`,
          markdown: `${fence} ${text} ${fence}`,
        };
      }
      const body = await renderChildren(n);
      if (tag === "a") {
        const url = absolute(attr(n, "href"), doc.url);
        const safe = safeSource(url);
        if (!safe) return body;
        const target =
          docs.find((d) => d.capture === doc.capture && d.url === url) ||
          destinations.get(url);
        if (target)
          return {
            html: `<a href="#${target.anchor}">${body.html}</a>`,
            markdown: `${body.markdown} _(captured section: ${md(
              target.title,
            )} · ${md(target.capture)})_`,
          };
        if (
          /\.pdf(?:[?#]|$)/i.test(url) ||
          attr(n, "type") === "application/pdf" ||
          n.attrs.some((a) => a.name === "download")
        ) {
          const path = await attachment(doc, url);
          if (path)
            return {
              html: `<a href="${path}" download>${body.html}</a>`,
              markdown: `${body.markdown} — saved attachment: \`${path}\` (some notes apps require manual attachment import)`,
            };
        }
        return {
          html: `<a href="${e(safe)}" rel="noreferrer">${
            body.html
          }</a> <small>(online)</small>`,
          markdown: `[${body.markdown}](<${safe
            .replace(/</g, "%3C")
            .replace(/>/g, "%3E")}>) (online)`,
        };
      }
      if (/^h[1-6]$/.test(tag)) {
        excerpt(visibleText(n));
        const level = Math.min(6, Number(tag[1]) + 2);
        return {
          html: `<h${level}>${body.html}</h${level}>`,
          markdown: `\n\n${"#".repeat(level)} ${body.markdown.trim()}\n\n`,
        };
      }
      if (tag === "p" || tag === "li") excerpt(visibleText(n));
      if (tag === "ul" || tag === "ol") {
        const items = await Promise.all(
          children(n)
            .filter((c) => "tagName" in c && c.tagName === "li")
            .map(render),
        );
        return {
          html: `<${tag}>${items.map((i) => i.html).join("")}</${tag}>`,
          markdown:
            "\n\n" +
            items
              .map(
                (i, index) =>
                  `${tag === "ol" ? index + 1 + "." : "-"} ${i.markdown
                    .trim()
                    .replace(/\n/g, "\n    ")}`,
              )
              .join("\n") +
            "\n\n",
        };
      }
      if (tag === "table") {
        const rows: Node[] = [];
        const collect = (node: Node) => {
          if (invisible(node)) return;
          for (const c of children(node)) {
            if (invisible(c)) continue;
            if ("tagName" in c && c.tagName === "tr") rows.push(c);
            else if (!("tagName" in c) || c.tagName !== "table") collect(c);
          }
        };
        collect(n);
        const cells = await Promise.all(
          rows.map((row) =>
            Promise.all(
              children(row)
                .filter(
                  (c) => "tagName" in c && ["td", "th"].includes(c.tagName),
                )
                .map(async (c) =>
                  (await render(c)).markdown.trim().replace(/\n/g, "<br>"),
                ),
            ),
          ),
        );
        if (!cells.length) return body;
        const width = Math.max(...cells.map((row) => row.length));
        const line = (row: string[]) =>
          "| " +
          Array.from({ length: width }, (_, i) => row[i] || "").join(" | ") +
          " |";
        return {
          html: `<table>${body.html}</table>`,
          markdown:
            "\n\n" +
            [
              line(cells[0]),
              line(Array(width).fill("---")),
              ...cells.slice(1).map(line),
            ].join("\n") +
            "\n\n",
        };
      }
      if (tag === "blockquote")
        return {
          html: `<blockquote>${body.html}</blockquote>`,
          markdown:
            "\n\n" +
            body.markdown
              .trim()
              .split("\n")
              .map((line) => "> " + line)
              .join("\n") +
            "\n\n",
        };
      if (tag === "strong" || tag === "b")
        return {
          html: `<strong>${body.html}</strong>`,
          markdown: `**${body.markdown}**`,
        };
      if (tag === "em" || tag === "i")
        return {
          html: `<em>${body.html}</em>`,
          markdown: `*${body.markdown}*`,
        };
      if (tag === "br") return { html: "<br>", markdown: "  \n" };
      if (tag === "hr") return { html: "<hr>", markdown: "\n\n---\n\n" };
      const allowed = new Set([
        "p",
        "li",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "div",
        "section",
        "article",
        "main",
        "aside",
        "summary",
        "details",
        "figure",
        "figcaption",
      ]);
      return {
        html: allowed.has(tag)
          ? `<${tag}${tag === "details" ? " open" : ""}>${body.html}</${tag}>`
          : body.html,
        markdown: [
          "p",
          "div",
          "section",
          "article",
          "main",
          "aside",
          "summary",
          "details",
          "figure",
          "figcaption",
        ].includes(tag)
          ? "\n\n" + body.markdown.trim() + "\n\n"
          : body.markdown,
      };
    };
    const result = doc.html
      ? await render(parse(doc.html))
      : {
          html: `<pre>${e(doc.text || "")}</pre>`,
          markdown: md(doc.text || ""),
        };
    if (doc.html && doc.text?.trim()) {
      result.html += `<h3>Recorded page text</h3><pre>${e(doc.text)}</pre>`;
      result.markdown +=
        "\n\n### Recorded page text\n\n" + md(doc.text) + "\n\n";
      warnings.push(
        `${doc.id}: recorded page text retained alongside HTML; overlapping text may repeat.`,
      );
    }
    if (!doc.html) {
      excerpt(doc.text || "");
      warnings.push(
        `${doc.id}: text-only source; original structure and attachments unavailable.`,
      );
    }
    if (!result.markdown.trim())
      warnings.push(`${doc.id}: no readable content found.`);
    sections.push({
      doc,
      ...result,
      excerpts,
      mode: doc.html ? "saved-html" : "recorded-text",
    });
  }
  const metadata = (doc: (typeof docs)[number]) =>
    `Capture: ${doc.capture} · ${doc.time || "time unavailable"} · Source: ${
      safeSource(doc.url) || "unavailable"
    }`;
  const warningText = [...new Set(warnings)];
  const notice =
    "Organized captured source material, not AI-generated or validated study notes. Distinct captures and embedded documents remain separate. Quick revision contains source excerpts only; course completion is not inferred.";
  const markdown = `# ${md(
    input.title,
  )}\n\n> ${notice}\n\n## Capture coverage\n\n${md(
    input.coverage,
  )}\n\n## Contents\n\n${sections
    .map((s) => `- **${md(s.doc.title)} · ${md(s.doc.capture)}**`)
    .join("\n")}\n\n${sections
    .map(
      (s) =>
        `## ${md(s.doc.title)}\n\n${md(
          metadata(s.doc),
        )}\n\n${s.markdown.trim()}`,
    )
    .join("\n\n---\n\n")}\n\n## Export warnings\n\n${
    warningText.length
      ? warningText.map((w) => "- " + md(w)).join("\n")
      : "No export warnings. This does not certify capture completeness."
  }\n`;
  const revision = `# Quick revision — source excerpts\n\n> These excerpts are selected mechanically from headings, paragraphs and list items. They are not a complete summary or validated guidance. Use the exact section references below in the detailed-notes page.\n\n${sections
    .map(
      (s) =>
        `## ${md(s.doc.title)}\n\n${md(metadata(s.doc))}\n\n${s.excerpts
          .map((v) => "- " + md(v))
          .join("\n")}\n\nDetailed source: **${md(s.doc.title)} · ${md(
          s.doc.capture,
        )}** in **${md(outputs.notes.replace(/\.md$/i, ""))}**`,
    )
    .join("\n\n")}\n`;
  let content = sections
    .map(
      (s) =>
        `<section id="${s.doc.anchor}"><h2>${e(
          s.doc.title,
        )}</h2><p class="muted">${e(metadata(s.doc))}</p>${s.html}</section>`,
    )
    .join("");
  // index.html is readable on its own; ZIP assets support portable Markdown imports.
  for (const asset of assets) {
    const bytes = files.get(asset.path)!;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const data = `data:${asset.mime};base64,${btoa(binary)}`;
    content = content
      .split(`src="${asset.path}"`)
      .join(`src="${data}"`)
      .split(`href="${asset.path}"`)
      .join(`href="${data}"`);
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src data:;style-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>${e(
    input.title,
  )}</title><style>body{font:17px/1.65 system-ui;color:#193e31;background:#edf4ef;max-width:1000px;margin:30px auto;padding:24px}section,nav,aside{background:white;padding:24px;margin:20px 0;border-radius:12px}a{color:#21624c}img{max-width:100%;height:auto}pre{white-space:pre-wrap;background:#f4f6f5;padding:16px}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #aac1b4;padding:8px}blockquote{border-left:4px solid #aac1b4;padding-left:18px}.muted{font-size:13px;overflow-wrap:anywhere;color:#50695d}section{scroll-margin-top:20px}</style></head><body><header><small>PAGETRAIL · PORTABLE LEARNING EXPORT</small><h1>${e(
    input.title,
  )}</h1><p>${e(notice)}</p><p>${e(
    input.coverage,
  )}</p></header><nav><h2>Contents</h2><ol>${sections
    .map(
      (s) =>
        `<li><a href="#${s.doc.anchor}">${e(s.doc.title)} · ${e(
          s.doc.capture,
        )}</a></li>`,
    )
    .join(
      "",
    )}</ol></nav>${content}<aside><h2>Export warnings</h2><ul>${warningText
    .map((w) => `<li>${e(w)}</li>`)
    .join(
      "",
    )}</ul><p>Online links remain labelled. No original scripts, forms or automatic remote requests are included.</p></aside></body></html>`;
  add(outputs.notes, encode(markdown));
  add(outputs.revision, encode(revision));
  add(outputs.reader, encode(html));
  add(
    outputs.instructions,
    encode(
      `PAGETRAIL PORTABLE LEARNING EXPORT\n\nUnzip this package. Open ${outputs.reader} for offline reading; its images and supported attachments are embedded, so this HTML can also be copied alone. Import "${outputs.notes}" and "${outputs.revision}" into a notes app while keeping the assets folder beside them. The quick-revision document contains labelled source excerpts, not AI-generated notes.\n\nAFFiNE validation: its Markdown-with-media ZIP importer preserves headings, nested lists, tables, code, Unicode and saved PNG/SVG images. It does not preserve custom section anchors or automatically attach linked PDF files. PageTrail therefore uses explicit section references instead of false Markdown navigation links. Add any PDF from assets manually if you need it inside AFFiNE; PDFs remain accessible in ${outputs.reader} and in the unzipped assets folder. Other notes apps may behave differently. No notes-app account or API is contacted by PageTrail.\n\n${outputs.manifest} lists sources, capture times, structure fallback, export warnings and SHA-256 checksums for every other file. Same-URL captures and frames remain separate. Supported saved images and PDFs are local; unavailable assets are explicitly reported. SVG geometry is sanitized, so some illustrations may differ. PDFs are original saved documents; open them in a PDF viewer. Online links are labelled. No quizzes, unvisited lessons or completion status are inferred.\n\nKeep the original WACZ for interactive replay and recovery. This package is a reading/migration copy, not a full website or a completeness certificate. Source URLs/content may contain private information; nothing was uploaded.\n`,
    ),
  );
  input.progress?.({ phase: "building", bytes: budget });
  const checksums = await Promise.all(
    [...files].map(async ([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: await hash(bytes),
    })),
  );
  const manifest = {
    schema: "pagetrail.learning.v1",
    title: input.title,
    generatedAt: new Date().toISOString(),
    sourceKind: "captured-source",
    notesValidated: false,
    completionStatus: "unknown",
    outputs,
    coverage: input.coverage,
    documents: sections.map((s) => ({
      id: s.doc.id,
      anchor: s.doc.anchor,
      title: s.doc.title,
      url: safeSource(s.doc.url),
      capture: s.doc.capture,
      capturedAt: s.doc.time,
      extraction: s.mode,
    })),
    assets,
    warnings: warningText,
    files: checksums,
  };
  add(outputs.manifest, encode(JSON.stringify(manifest, null, 2)));
  const blob = await downloadZip(
    [...files].map(([name, input]) => ({
      name,
      input,
    })),
  ).blob();
  if (blob.size > MAX)
    throw new OperationError(
      "EXPORT_TOO_LARGE",
      "Learning package exceeds 100 MB.",
    );
  return { blob, files, manifest, missing: warningText.length };
}
