// SPDX-License-Identifier: AGPL-3.0-or-later
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import type { LearningDocument } from "./portable";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export type LearningOrganization = {
  documents: LearningDocument[];
  suggestedTitle?: string;
  missingOutline: { title: string; url: string }[];
  stats: {
    inputDocuments: number;
    outputSections: number;
    omittedShells: number;
    consolidatedDuplicates: number;
    excludedOutOfScope: number;
    detectedOutlineItems: number;
    capturedOutlineItems: number;
    missingOutlineItems: number;
  };
};

const children = (node: Node) =>
  "childNodes" in node ? node.childNodes : [];
const element = (node: Node): node is Element => "tagName" in node;
const attribute = (node: Node, name: string) =>
  element(node)
    ? node.attrs.find((item) => item.name === name)?.value || ""
    : "";
const hidden = (node: Node) =>
  element(node) &&
  (node.attrs.some((item) => item.name === "hidden") ||
    attribute(node, "aria-hidden") === "true" ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
      attribute(node, "style"),
    ));
const OMIT = new Set([
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
  "nav",
  "header",
  "footer",
]);
const visibleText = (node: Node): string => {
  if (hidden(node) || (element(node) && OMIT.has(node.tagName))) return "";
  if (node.nodeName === "#text" && "value" in node) return node.value;
  return children(node).map(visibleText).join(" ");
};
const cleanText = (value: string) => value.replace(/\s+/g, " ").trim();
const nodes = (root: Node) => {
  const result: Element[] = [];
  const visit = (node: Node) => {
    if (element(node)) result.push(node);
    for (const child of children(node)) visit(child);
  };
  visit(root);
  return result;
};
const count = (root: Node, tags: Set<string>) =>
  nodes(root).filter((node) => tags.has(node.tagName) && !hidden(node)).length;
const firstText = (root: Node, tags: Set<string>) => {
  const found = nodes(root).find(
    (node) => tags.has(node.tagName) && cleanText(visibleText(node)),
  );
  return found ? cleanText(visibleText(found)) : "";
};
const sensibleTitle = (value: string) => {
  const title = cleanText(value).replace(/\s+[|·-]\s+Capture\s+\d+$/i, "");
  return title.length >= 3 && title.length <= 180 ? title : "";
};
const semanticBonus = (node: Element) => {
  const identity = `${node.tagName} ${attribute(node, "id")} ${attribute(
    node,
    "class",
  )} ${attribute(node, "role")}`.toLowerCase();
  if (node.tagName === "main" || attribute(node, "role") === "main") return 1600;
  if (node.tagName === "article") return 1000;
  if (
    /(?:^|[\s_-])(?:lesson|course|training|article|page)[\s_-]*(?:main|content|body)(?:$|[\s_-])/.test(
      identity,
    ) ||
    /(?:lesson-main|lesson__content|page__content|content-main|content-body)/.test(
      identity,
    )
  )
    return 800;
  return 0;
};
const facts = (root: Node) => {
  const text = cleanText(visibleText(root));
  const headings = count(root, new Set(["h1", "h2", "h3", "h4", "h5", "h6"]));
  const images = count(root, new Set(["img"]));
  const listItems = count(root, new Set(["li"]));
  const links = count(root, new Set(["a"]));
  const frames = count(root, new Set(["iframe"]));
  return {
    text,
    headings,
    images,
    listItems,
    links,
    frames,
    quality:
      text.length + headings * 280 + images * 90 + listItems * 35 - links * 4,
  };
};
const canonicalUrl = (value: string) => {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()])
      if (
        /^(?:auth|cache|code|credential|fbclid|gclid|jwt|key|secret|session|signature|token|ts|timestamp|utm_.+)$/i.test(
          key,
        )
      )
        url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch {
    return value;
  }
};
const lessonBase = (value: string) => {
  try {
    const url = new URL(value);
    if (!/\/(?:lessons?|modules?|chapters?)\//i.test(url.hash)) return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
};
const outlineLabel = (value: string) =>
  sensibleTitle(
    cleanText(value)
      .replace(/\b(?:completed|complete|current|locked|not started)\b/gi, "")
      .trim(),
  ) || "Captured course section";
const pageTitle = (root: Node) =>
  sensibleTitle(firstText(root, new Set(["title"])));
const commonCourseTitle = (titles: string[]) => {
  const candidates = titles.flatMap((title) => {
    const parts = title.split(/\s+(?:-|\||·)\s+/).map(sensibleTitle).filter(Boolean);
    return parts.length > 1 ? parts.slice(1) : [];
  });
  const counts = new Map<string, number>();
  for (const candidate of candidates)
    counts.set(candidate, (counts.get(candidate) || 0) + 1);
  return [...counts]
    .filter(([, uses]) => uses >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
};
const playerShell = (value: string) => {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /(?:\/rustici\/(?:launch|defaultui\/player)|\/scormdriver\/(?:indexapi|aicccomm|blank)|\/pre-launch\.html$)/.test(
      path,
    );
  } catch {
    return false;
  }
};

/**
 * Turns browser-serialization documents into human reading sections. Recorder
 * shells and repeated frames remain in the archive/manifest, while notes keep
 * the richest semantic view for each lesson or page URL.
 */
export function organizeLearningDocuments(
  documents: LearningDocument[],
): LearningOrganization {
  const navigationOrder = new Map<string, number>();
  const navigationLabels = new Map<string, string>();
  const candidates: {
    document: LearningDocument;
    pageTitle: string;
    lessonTitle: string;
    group: string;
    quality: number;
    order: number;
  }[] = [];
  let omittedShells = 0;
  for (const [order, document] of documents.entries()) {
    if (!document.html) {
      const text = cleanText(document.text || "");
      if (text.length < 80) {
        omittedShells++;
        continue;
      }
      candidates.push({
        document,
        pageTitle: "",
        lessonTitle: sensibleTitle(document.title) || "Captured page",
        group: canonicalUrl(document.url),
        quality: text.length,
        order,
      });
      continue;
    }
    const tree = parse(document.html);
    const all = nodes(tree);
    for (const link of all.filter((node) => node.tagName === "a")) {
      const href = attribute(link, "href");
      try {
        const target = canonicalUrl(new URL(href, document.url).href);
        if (
          /\/(?:lessons?|modules?|chapters?)\//i.test(new URL(target).hash) &&
          !navigationOrder.has(target)
        ) {
          navigationOrder.set(target, navigationOrder.size);
          navigationLabels.set(target, outlineLabel(visibleText(link)));
        }
      } catch {
        // Malformed links cannot provide ordering information.
      }
    }
    const body = all.find((node) => node.tagName === "body") || tree;
    const semantic = all
      .map((node) => ({ node, bonus: semanticBonus(node) }))
      .filter((item) => item.bonus > 0 && !hidden(item.node))
      .map((item) => {
        const details = facts(item.node);
        return { ...item, details, score: item.bonus + details.quality };
      })
      .filter((item) => item.details.text.length >= 40)
      .sort((a, b) => b.score - a.score);
    const selected = semantic[0]?.node || body;
    const details = facts(selected);
    const meaningful =
      (details.headings > 0 && details.text.length >= 40) ||
      details.text.length >= 180 ||
      (details.images > 0 && details.text.length >= 70) ||
      details.listItems >= 2;
    if (
      !meaningful ||
      (!semantic.length &&
        (playerShell(document.url) ||
          (details.frames > 0 && details.text.length < 500)))
    ) {
      omittedShells++;
      continue;
    }
    const heading = sensibleTitle(
      firstText(selected, new Set(["h1", "h2", "h3"])),
    );
    const htmlTitle = pageTitle(tree);
    const lessonTitle = heading || htmlTitle || sensibleTitle(document.title) || "Captured page";
    const cleanDocument = {
      ...document,
      title: lessonTitle,
      html: serialize(selected),
    };
    candidates.push({
      document: cleanDocument,
      pageTitle: htmlTitle,
      lessonTitle,
      group: canonicalUrl(document.url),
      quality: details.quality + (semantic.length ? 1000 : 0),
      order,
    });
  }

  // Never turn a non-empty recording into an empty export. This fallback is
  // deliberately rare and remains labelled by the portable builder.
  if (!candidates.length && documents.length) {
    const fallback = documents.reduce((best, document) => {
      const size = (document.html || document.text || "").length;
      return size > best.size ? { document, size } : best;
    }, { document: documents[0], size: -1 });
    candidates.push({
      document: fallback.document,
      pageTitle: "",
      lessonTitle: sensibleTitle(fallback.document.title) || "Captured page",
      group: canonicalUrl(fallback.document.url),
      quality: fallback.size,
      order: 0,
    });
    omittedShells = Math.max(0, documents.length - 1);
  }

  const grouped = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.group);
    if (!current) grouped.set(candidate.group, candidate);
    else
      grouped.set(candidate.group, {
        ...candidate,
        order: Math.min(current.order, candidate.order),
        pageTitle: candidate.pageTitle || current.pageTitle,
      });
  }
  const courseBases = new Map<string, Set<string>>();
  for (const target of navigationOrder.keys()) {
    const base = lessonBase(target);
    if (!base) continue;
    const routes = courseBases.get(base) || new Set<string>();
    routes.add(target);
    courseBases.set(base, routes);
  }
  for (const candidate of grouped.values()) {
    const base = lessonBase(candidate.document.url);
    if (!base) continue;
    const routes = courseBases.get(base) || new Set<string>();
    routes.add(canonicalUrl(candidate.document.url));
    courseBases.set(base, routes);
  }
  const dominantBase = [...courseBases]
    .filter(([, routes]) => routes.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  const scopedCandidates = [...grouped.values()].filter(
    (candidate) => lessonBase(candidate.document.url) === dominantBase,
  );
  const scopedRoutes = new Set(
    scopedCandidates.map((candidate) => canonicalUrl(candidate.document.url)),
  );
  const activeBase = dominantBase && scopedRoutes.size >= 2 ? dominantBase : "";
  const inScope = activeBase ? scopedCandidates : [...grouped.values()];
  const excludedOutOfScope = Math.max(0, grouped.size - inScope.length);
  const selected = inScope.sort((a, b) => {
    const aNavigation = navigationOrder.get(canonicalUrl(a.document.url));
    const bNavigation = navigationOrder.get(canonicalUrl(b.document.url));
    if (aNavigation !== undefined && bNavigation !== undefined)
      return aNavigation - bNavigation;
    if (aNavigation !== undefined) return -1;
    if (bNavigation !== undefined) return 1;
    return a.order - b.order;
  });
  const suggestedTitle = commonCourseTitle(
    selected.map((candidate) => candidate.pageTitle).filter(Boolean),
  );
  const outline = [...navigationOrder.keys()].filter(
    (target) => activeBase && lessonBase(target) === activeBase,
  );
  const selectedRoutes = new Set(
    selected.map((candidate) => canonicalUrl(candidate.document.url)),
  );
  const missingOutline = outline
    .filter((target) => !selectedRoutes.has(target))
    .map((url) => ({
      title: navigationLabels.get(url) || "Captured course section",
      url,
    }));
  const capturedOutlineItems = outline.filter((target) =>
    selectedRoutes.has(target),
  ).length;
  return {
    documents: selected.map((candidate) => candidate.document),
    ...(suggestedTitle ? { suggestedTitle } : {}),
    missingOutline,
    stats: {
      inputDocuments: documents.length,
      outputSections: selected.length,
      omittedShells,
      excludedOutOfScope,
      detectedOutlineItems: outline.length,
      capturedOutlineItems,
      missingOutlineItems: missingOutline.length,
      consolidatedDuplicates: Math.max(
        0,
        documents.length -
          omittedShells -
          excludedOutOfScope -
          selected.length,
      ),
    },
  };
}
