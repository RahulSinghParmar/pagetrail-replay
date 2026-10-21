// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import { parse, type DefaultTreeAdapterMap } from "parse5";
export type SavedPage = {
  id?: string;
  url: string;
  title?: string;
  text?: string;
  ts?: number;
};
export type ReadingSection = {
  url: string;
  title: string;
  text: string;
  captures: number;
  fallback: boolean;
};
export type ReadingBook = {
  title: string;
  sections: ReadingSection[];
  missing: string[];
  coverage?: string;
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
  "svg",
  "canvas",
]);
const BLOCK = new Set([
  "p",
  "div",
  "article",
  "section",
  "main",
  "h1",
  "h2",
  "h3",
  "h4",
  "li",
  "tr",
  "br",
  "pre",
  "blockquote",
]);
const clean = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
export function textFromHtml(html: string): string {
  // parse5 is an inert parser: no scripts run and no image/frame URLs are fetched.
  const parts: string[] = [];
  function visit(node: DefaultTreeAdapterMap["node"]) {
    if ("tagName" in node) {
      if (
        SKIP.has(node.tagName) ||
        node.attrs.some(
          (attr) =>
            attr.name === "hidden" ||
            (attr.name === "aria-hidden" && attr.value === "true"),
        )
      )
        return;
      if (BLOCK.has(node.tagName)) parts.push("\n");
    }
    if (node.nodeName === "#text" && "value" in node)
      parts.push(node.value.replace(/\s+/g, " "));
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    if ("tagName" in node && BLOCK.has(node.tagName)) parts.push("\n");
    if ("tagName" in node && ["td", "th"].includes(node.tagName))
      parts.push(" | ");
  }
  visit(parse(html));
  return clean(parts.join(""));
}
export function safeSource(raw: string): string {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return "";
  }
}
export async function collectReadingBook(
  title: string,
  pages: SavedPage[],
  savedHtml: (page: SavedPage) => Promise<string | null>,
): Promise<ReadingBook> {
  const groups = new Map<string, ReadingSection>();
  const missing: string[] = [];
  for (const page of [...pages].sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    let text = clean(page.text || ""),
      fallback = false;
    if (!text) {
      const html = await savedHtml(page);
      if (html) {
        text = textFromHtml(html);
        fallback = true;
      }
    }
    const name = page.title || "Untitled page",
      url = safeSource(page.url);
    if (!text) {
      missing.push(name + " — " + (url || "source URL unavailable"));
      continue;
    }
    const key = url || page.url;
    const previous = groups.get(key);
    if (!previous)
      groups.set(key, { url, title: name, text, captures: 1, fallback });
    else {
      // Consolidate repeated visits to one URL, preserving newly captured lines.
      const seen = new Set(
        previous.text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
      const extra = text
        .split("\n")
        .filter((line) => line.trim() && !seen.has(line.trim()));
      if (extra.length) previous.text += "\n\n" + extra.join("\n");
      previous.title = name;
      previous.captures++;
      previous.fallback ||= fallback;
    }
  }
  if (!groups.size)
    throw new Error(
      "No readable text was saved in this archive. The archive is unchanged. Revisit the material while recording and Finish, or retain a WACZ for replay.",
    );
  return { title, sections: [...groups.values()], missing };
}
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const escapeMd = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}[\]()#+!|])/g, "\\$1");
export function readingHtml(book: ReadingBook): string {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>${e(
    book.title,
  )}</title><style>body{font:18px/1.7 system-ui;margin:32px auto;max-width:950px;padding:24px;background:#eff5f1;color:#203f33}h1{line-height:1.2}section,nav,aside{background:#fff;border:1px solid #cadbd0;border-radius:12px;padding:24px;margin:20px 0}a{color:#21624c}small{display:block;overflow-wrap:anywhere;color:#536b5e}.content{white-space:pre-wrap;overflow-wrap:anywhere}section{scroll-margin-top:20px}@media print{body{background:white}section{break-before:page}}</style></head><body><header id="top"><small>PAGETRAIL · READING EXPORT</small><h1>${e(
    book.title,
  )}</h1><p>${
    book.sections.length
  } readable pages in one HTML file. Original scripts, layout, images and interactive behavior are not reproduced. Repeated visits to the same URL are consolidated; this is recorded source text, not validated study notes.</p></header><nav aria-label="Contents"><h2>Contents</h2><ol>${book.sections
    .map(
      (section, i) =>
        `<li><a href="#page-${i + 1}">${e(section.title)}</a></li>`,
    )
    .join("")}</ol></nav>${
    book.missing.length
      ? `<aside><h2>Coverage warning</h2><p>No readable text was available for ${
          book.missing.length
        } captured entries:</p><ul>${book.missing
          .map((item) => `<li>${e(item)}</li>`)
          .join("")}</ul></aside>`
      : ""
  }${
    book.coverage
      ? `<aside><h2>Capture coverage</h2><p>${e(book.coverage)}</p></aside>`
      : ""
  }${book.sections
    .map(
      (section, i) =>
        `<section id="page-${i + 1}"><h2>${e(section.title)}</h2>${
          section.url
            ? `<small>Original source (online): <a href="${e(
                section.url,
              )}" target="_blank" rel="noopener noreferrer">${e(
                section.url,
              )}</a></small>`
            : ""
        }<small>${section.captures} captured visit(s) consolidated${
          section.fallback
            ? " · includes text extracted from saved HTML"
            : " · recorded page text"
        }</small><div class="content">${e(
          section.text,
        )}</div><p><a href="#top">Back to contents</a></p></section>`,
    )
    .join(
      "",
    )}<footer>Kept local. Review for confidential data before sharing or importing into another service.</footer></body></html>`;
}
export function readingMarkdown(book: ReadingBook): string {
  const e = escapeMd;
  return `# ${e(
    book.title,
  )}\n\n> Reading export of captured source text, not validated notes or an interactive website. Repeated visits to one URL are consolidated. Original layout, scripts and images are not included.\n\n${
    book.coverage ? "## Capture coverage\n\n" + e(book.coverage) + "\n\n" : ""
  }${
    book.missing.length
      ? "## Coverage warning\n\nNo readable text was available for:\n\n" +
        book.missing.map((item) => "- " + e(item)).join("\n") +
        "\n\n"
      : ""
  }${book.sections
    .map(
      (section) =>
        `## ${e(section.title)}\n\n${
          section.url ? "Source (online): <" + section.url + ">\n\n" : ""
        }${e(section.text)}\n`,
    )
    .join(
      "\n---\n\n",
    )}\n---\nReview for confidential data before sharing or importing into another service.\n`;
}
