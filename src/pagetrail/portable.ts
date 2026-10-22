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
const MAX_NOTE_ASSET = 5 * 1024 * 1024;
const MAX_NOTE_MEDIA = 20 * 1024 * 1024;
const OPTIMIZE_RASTER_OVER = 768 * 1024;
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

async function compactImage(asset: LearningAsset): Promise<LearningAsset | null> {
  if (
    !asset.mime.toLowerCase().startsWith("image/") ||
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas === "undefined"
  )
    return null;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(
      new Blob([asset.bytes as BlobPart], { type: asset.mime }),
    );
    const scale = Math.min(1, 1600 / bitmap.width, 1600 / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return bytes.length <= MAX_NOTE_ASSET
      ? { mime: "image/webp", bytes }
      : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

export async function buildLearningExport(input: {
  title: string;
  documents: LearningDocument[];
  coverage: string;
  warnings?: string[];
  organization?: {
    inputDocuments: number;
    outputSections: number;
    omittedShells: number;
    consolidatedDuplicates: number;
    excludedOutOfScope?: number;
    detectedOutlineItems?: number;
    capturedOutlineItems?: number;
    missingOutlineItems?: number;
  };
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
  const assetFailures = new Map<string, string>();
  let budget = 0,
    inputBytes = 0,
    nodes = 0,
    mediaBytes = 0,
    optimizedMedia = 0,
    optimizedInputBytes = 0,
    optimizedOutputBytes = 0,
    omittedMedia = 0;
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
          let raw = await input.resolveAsset(doc, url);
          const originalBytes = raw?.bytes.length || 0;
          let optimized = false;
          const raster =
            raw && /image\/(?:png|jpeg|gif|webp)/i.test(raw.mime.split(";")[0]);
          if (raw && raster && raw.bytes.length > OPTIMIZE_RASTER_OVER) {
            const compact = await compactImage(raw);
            if (
              compact &&
              (raw.bytes.length > MAX_NOTE_ASSET ||
                compact.bytes.length <= raw.bytes.length * 0.9)
            ) {
              raw = compact;
              optimized = true;
            } else if (raw.bytes.length > MAX_NOTE_ASSET) {
              assetFailures.set(
                key,
                "omitted from the notes package; original remains in the source archive",
              );
              omittedMedia++;
              warnings.push(
                `${doc.id}: asset omitted from the notes package because it exceeds 5 MB; the original remains in the source archive: ${
                  safeSource(url) || "embedded resource"
                }`,
              );
              return null;
            }
          }
          const asset = raw && safeLearningAsset(raw);
          if (!asset) {
            assetFailures.set(
              key,
              raw ? "unsupported notes attachment" : "not captured",
            );
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
            if (mediaBytes + asset.bytes.length > MAX_NOTE_MEDIA) {
              assetFailures.set(
                key,
                "omitted from the notes package; original remains in the source archive",
              );
              omittedMedia++;
              warnings.push(
                `${doc.id}: asset omitted because the notes-package media budget is 20 MB; the original remains in the source archive: ${
                  safeSource(url) || "embedded resource"
                }`,
              );
              return null;
            }
            add(path, asset.bytes);
            mediaBytes += asset.bytes.length;
            if (optimized) {
              optimizedMedia++;
              optimizedInputBytes += originalBytes;
              optimizedOutputBytes += asset.bytes.length;
            }
            assets.push({
              path,
              mime: asset.mime,
              bytes: asset.bytes.length,
              sha256: digest,
            });
          }
          assetFailures.delete(key);
          return path;
        })(),
      );
    return assetUrls.get(key)!;
  };
  const sections: {
    doc: (typeof docs)[number];
    html: string;
    markdown: string;
    excerpts: { text: string; kind: "heading" | "point" }[];
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
    const excerpts: { text: string; kind: "heading" | "point" }[] = [];
    const excerpt = (s: string, kind: "heading" | "point") => {
      const clean = s.replace(/\s+/g, " ").trim();
      const key = clean.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (
        clean.length >= 12 &&
        /\p{L}/u.test(clean) &&
        !/^(?:skip to lesson|top of page|continue|more|back|next|previous)$/i.test(clean) &&
        excerpts.length < 10 &&
        !excerpts.some(
          (item) =>
            item.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() ===
            key,
        )
      )
        excerpts.push({
          text: clean.length > 260 ? clean.slice(0, 260) + "…" : clean,
          kind,
        });
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
        const reason =
          (url && assetFailures.get(doc.id + "\n" + url)) || "not captured";
        return path
          ? {
              html: `<img src="${path}" alt="${e(alt)}">`,
              markdown: `![${md(alt)}](${path})`,
            }
          : {
              html: `<p>[Image unavailable — ${e(reason)}: ${e(alt)}]</p>`,
              markdown: `[Image unavailable — ${md(reason)}: ${md(alt)}]`,
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
        excerpt(visibleText(n), "heading");
        const level = Math.min(6, Number(tag[1]) + 2);
        return {
          html: `<h${level}>${body.html}</h${level}>`,
          markdown: `\n\n${"#".repeat(level)} ${body.markdown.trim()}\n\n`,
        };
      }
      if (tag === "p") excerpt(visibleText(n), "point");
      if (tag === "li") {
        const ownText = children(n)
          .filter(
            (child) =>
              !("tagName" in child) || !["ul", "ol"].includes(child.tagName),
          )
          .map(visibleText)
          .join(" ");
        excerpt(ownText, "point");
      }
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
      excerpt(doc.text || "", "point");
      warnings.push(
        `${doc.id}: text-only source; original structure and attachments unavailable.`,
      );
    }
    if (!result.markdown.trim())
      warnings.push(`${doc.id}: no readable content found.`);
    sections.push({
      doc,
      ...result,
      markdown: result.markdown
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      excerpts,
      mode: doc.html ? "saved-html" : "recorded-text",
    });
  }
  const sourceReference = (value: string) => {
    const safe = safeSource(value);
    if (!safe) return "";
    try {
      const url = new URL(safe);
      for (const key of [...url.searchParams.keys()])
        if (/(?:auth|code|credential|jwt|key|secret|session|signature|token)/i.test(key))
          url.searchParams.delete(key);
      return url.href;
    } catch {
      return safe;
    }
  };
  const metadata = (doc: (typeof docs)[number]) =>
    `${doc.capture}${doc.time ? ` · ${doc.time}` : ""}`;
  const warningText = [...new Set(warnings)];
  const notice =
    "Structured from captured source material. Repeated recorder shells and duplicate page states are consolidated. Verify important procedures against the original source; these notes are not a completeness certificate.";
  const organization = input.organization || {
    inputDocuments: sections.length,
    outputSections: sections.length,
    omittedShells: 0,
    consolidatedDuplicates: 0,
    excludedOutOfScope: 0,
    detectedOutlineItems: 0,
    capturedOutlineItems: 0,
    missingOutlineItems: 0,
  };
  const scopeDiagnostic = organization.excludedOutOfScope
    ? `\n- Excluded **${organization.excludedOutOfScope}** captured page section${organization.excludedOutOfScope === 1 ? "" : "s"} outside the dominant course scope.`
    : "";
  const outlineDiagnostic = organization.detectedOutlineItems
    ? `\n- Captured settled content for **${organization.capturedOutlineItems || 0} of ${organization.detectedOutlineItems}** detected course-outline sections${organization.missingOutlineItems ? `; **${organization.missingOutlineItems}** section${organization.missingOutlineItems === 1 ? " was" : "s were"} missing from this recording` : ""}.`
    : "";
  const mediaDiagnostic = `\n- Included **${assets.length}** local media file${assets.length === 1 ? "" : "s"} (${mediaBytes} bytes)${optimizedMedia ? `; optimized **${optimizedMedia}** large raster image${optimizedMedia === 1 ? "" : "s"} from ${optimizedInputBytes} to ${optimizedOutputBytes} bytes` : ""}${omittedMedia ? `; omitted **${omittedMedia}** media reference${omittedMedia === 1 ? "" : "s"} under package limits` : ""}.`;
  const sourceList = sections
    .map((section) => {
      const source = sourceReference(section.doc.url);
      return `- **${md(section.doc.title)}** — ${md(metadata(section.doc))}${
        source
          ? ` · [Original captured page](<${source.replace(/</g, "%3C").replace(/>/g, "%3E")}>)`
          : ""
      }`;
    })
    .join("\n");
  const markdown = `# ${md(
    input.title,
  )}\n\n> ${notice}\n\n## Course outline\n\n${sections
    .map((s, index) => `${index + 1}. **${md(s.doc.title)}**`)
    .join("\n")}\n\n${sections
    .map(
      (s) =>
        `## ${md(s.doc.title)}\n\n${s.markdown}`,
    )
    .join("\n\n---\n\n")}\n\n## Source references\n\n${sourceList}\n\n## Capture diagnostics\n\n- Organized **${organization.inputDocuments}** captured documents into **${organization.outputSections}** reading sections.\n- Omitted **${organization.omittedShells}** recorder/player shells and consolidated **${organization.consolidatedDuplicates}** repeated sections.${scopeDiagnostic}${outlineDiagnostic}${mediaDiagnostic}\n- ${md(input.coverage)}\n- ${warningText.length ? `${warningText.length} technical warning${warningText.length === 1 ? "" : "s"} recorded in \`manifest.json\`.` : "No technical export warnings were recorded."}\n`;
  const revisionSeen = new Set<string>();
  const revisionSections = sections
    .map(
      (section) => {
        const titleKey = section.doc.title.toLowerCase();
        const points = section.excerpts.filter((item) => {
          const key = item.text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim();
          if (!key || key === titleKey || revisionSeen.has(key)) return false;
          revisionSeen.add(key);
          return true;
        });
        return points.length
          ? `## ${md(section.doc.title)}\n\n${points
              .map((item) =>
                item.kind === "heading"
                  ? `- **${md(item.text)}**`
                  : `- ${md(item.text)}`,
              )
              .join("\n")}`
          : "";
      },
    )
    .filter(Boolean)
    .join("\n\n");
  const revision = `# ${md(input.title)} — Quick revision\n\n> Review points selected mechanically from the organized lesson sections. Confirm critical details in the detailed notes or original source.\n\n${revisionSections}\n\nDetailed source: **${md(outputs.notes.replace(/\.md$/i, ""))}**\n`;
  const content = sections
    .map(
      (s) =>
        `<section id="${s.doc.anchor}"><h2>${e(
          s.doc.title,
        )}</h2>${s.html}</section>`,
    )
    .join("");
  // The learning ZIP keeps one copy of each asset. The separate website-session
  // export remains the self-contained single-HTML format.
  const htmlSources = sections
    .map((section) => {
      const source = sourceReference(section.doc.url);
      return `<li><strong>${e(section.doc.title)}</strong> — ${e(
        metadata(section.doc),
      )}${source ? ` · <a href="${e(source)}" rel="noreferrer">original captured page</a>` : ""}</li>`;
    })
    .join("");
  const htmlScopeDiagnostic = organization.excludedOutOfScope
    ? `<li>Excluded ${organization.excludedOutOfScope} captured page section${organization.excludedOutOfScope === 1 ? "" : "s"} outside the dominant course scope.</li>`
    : "";
  const htmlOutlineDiagnostic = organization.detectedOutlineItems
    ? `<li>Captured settled content for ${organization.capturedOutlineItems || 0} of ${organization.detectedOutlineItems} detected course-outline sections${organization.missingOutlineItems ? `; ${organization.missingOutlineItems} section${organization.missingOutlineItems === 1 ? " was" : "s were"} missing from this recording` : ""}.</li>`
    : "";
  const htmlMediaDiagnostic = `<li>Included ${assets.length} local media file${assets.length === 1 ? "" : "s"} (${mediaBytes} bytes)${optimizedMedia ? `; optimized ${optimizedMedia} large raster image${optimizedMedia === 1 ? "" : "s"} from ${optimizedInputBytes} to ${optimizedOutputBytes} bytes` : ""}${omittedMedia ? `; omitted ${omittedMedia} media reference${omittedMedia === 1 ? "" : "s"} under package limits` : ""}.</li>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src 'self' data:;style-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>${e(
    input.title,
  )}</title><style>body{font:17px/1.65 system-ui;color:#193e31;background:#edf4ef;max-width:1000px;margin:30px auto;padding:24px}section,nav,aside{background:white;padding:24px;margin:20px 0;border-radius:12px}a{color:#21624c}img{max-width:100%;height:auto}pre{white-space:pre-wrap;background:#f4f6f5;padding:16px}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #aac1b4;padding:8px}blockquote{border-left:4px solid #aac1b4;padding-left:18px}.muted{font-size:13px;overflow-wrap:anywhere;color:#50695d}section{scroll-margin-top:20px}</style></head><body><header><small>PAGETRAIL · PORTABLE LEARNING EXPORT</small><h1>${e(
    input.title,
  )}</h1><p>${e(notice)}</p></header><nav><h2>Course outline</h2><ol>${sections
    .map(
      (s) =>
        `<li><a href="#${s.doc.anchor}">${e(s.doc.title)}</a></li>`,
    )
    .join(
      "",
    )}</ol></nav>${content}<aside><h2>Source references</h2><ul>${htmlSources}</ul><h2>Capture diagnostics</h2><ul><li>Organized ${organization.inputDocuments} captured documents into ${organization.outputSections} reading sections.</li><li>Omitted ${organization.omittedShells} recorder/player shells and consolidated ${organization.consolidatedDuplicates} repeated sections.</li>${htmlScopeDiagnostic}${htmlOutlineDiagnostic}${htmlMediaDiagnostic}<li>${e(input.coverage)}</li><li>${warningText.length} technical warning${warningText.length === 1 ? "" : "s"} recorded in manifest.json.</li></ul><p>Online links remain labelled. No original scripts, forms or automatic remote requests are included.</p></aside></body></html>`;
  add(outputs.notes, encode(markdown));
  add(outputs.revision, encode(revision));
  add(outputs.reader, encode(html));
  add(
    outputs.instructions,
    encode(
      `PAGETRAIL PORTABLE LEARNING EXPORT\n\nUnzip this package and keep its assets folder beside ${outputs.reader} and the Markdown files. Open ${outputs.reader} for offline reading. Import "${outputs.notes}" and "${outputs.revision}" into a notes app while keeping the assets folder beside them. The package stores one copy of each media file; use the separate website-session export when you need a self-contained single HTML. The package consolidates repeated recorder shells and page states into lesson-centered reading sections. When a repeated course outline is detected, unrelated portal pages are excluded and outline sections without settled captured content are reported. Quick revision contains mechanically selected review points, not validated guidance.\n\nAFFiNE validation: its Markdown-with-media ZIP importer preserves headings, nested lists, tables, code, Unicode and saved PNG/SVG images. It does not preserve custom section anchors or automatically attach linked PDF files. Add any PDF from assets manually if you need it inside AFFiNE; PDFs remain accessible in ${outputs.reader} and in the unzipped assets folder. Raster images over 768 KB are converted to a bounded static WebP preview when the browser supports it and the result is materially smaller. Individual included files remain capped at 5 MB and total note-package media at 20 MB; later media is omitted with an explicit warning when those limits are reached. Originals remain in the source recording and website-session/WACZ exports. Other notes apps may behave differently. No notes-app account or API is contacted by PageTrail.\n\n${outputs.manifest} lists source sections, capture times, organization statistics, media optimization, extraction fallbacks, export warnings and SHA-256 checksums for every other file. Supported saved images and PDFs are local; unavailable assets are explicitly reported. SVG geometry is sanitized, so some illustrations may differ. PDFs are original saved documents; open them in a PDF viewer. Online links are labelled. Assessment-result summaries may be retained when captured, but PageTrail does not infer, reconstruct or answer quiz questions. Unvisited lessons or completion status are not inferred.\n\nKeep the original WACZ or website-session HTML for interactive replay and recovery. This package is a reading/migration copy, not a full website or a completeness certificate. Source URLs/content may contain private information; nothing was uploaded.\n`,
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
    schema: "pagetrail.learning.v2",
    title: input.title,
    generatedAt: new Date().toISOString(),
    sourceKind: "captured-source",
    notesValidated: false,
    completionStatus: "unknown",
    outputs,
    coverage: input.coverage,
    organization,
    media: {
      maxAssetBytes: MAX_NOTE_ASSET,
      maxTotalBytes: MAX_NOTE_MEDIA,
      includedAssets: assets.length,
      includedBytes: mediaBytes,
      optimizedAssets: optimizedMedia,
      optimizedInputBytes,
      optimizedOutputBytes,
      omittedReferences: omittedMedia,
    },
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
