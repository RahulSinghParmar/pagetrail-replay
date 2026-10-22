// SPDX-License-Identifier: AGPL-3.0-or-later
import { readVisualArchive, type VisualState } from "./visual-store";
import {
  buildLearningExport,
  type LearningDocument,
  type LearningAsset,
} from "./portable";
import { coverageText, coverageGaps, type CoverageSummary } from "./coverage";
import type { ExportProgress } from "./export-protocol";
import type { DBCollection } from "../sw/downloader";
import type { SavedPage } from "./reading";
import { OperationError } from "./operations";
import { organizeLearningDocuments } from "./learning-organize";

export async function createLearningExport(
  id: string,
  title: string | undefined,
  coverage: CoverageSummary | undefined,
  progress: (p: ExportProgress) => void,
) {
  const visual = await readVisualArchive(id, { progress });
  const assets = new Map(visual.assets.map((asset) => [asset.key, asset]));
  let documents: LearningDocument[] = [];
  const origins = new Map<string, VisualState>();
  const warnings: string[] = visual.meta.error
    ? [
        "Visual capture reported a gap. Review the source recording and coverage.",
      ]
    : [];
  let collection: DBCollection | null | undefined;
  let opening: Promise<DBCollection | null> | undefined;
  const open = async () => {
    opening ??= (async () => {
      const { CollectionLoader } = await import("@webrecorder/wabac/swlib");
      collection = (await new CollectionLoader().loadColl(
        id,
      )) as DBCollection | null;
      if (collection) await collection.store.initing;
      return collection;
    })();
    return opening;
  };
  const savedAsset = async (
    url: string,
    ts: number,
  ): Promise<LearningAsset | null> => {
    const coll = await open();
    if (!coll) return null;
    const resource = await coll.store.lookupUrl(url, ts);
    if (!resource || (resource.status && resource.status >= 400)) return null;
    const payload = await coll.store.loadPayload(resource, {});
    if (!(payload instanceof Uint8Array) || payload.length > 20 * 1024 * 1024)
      return null;
    return {
      mime: resource.mime || "application/octet-stream",
      bytes: payload,
    };
  };
  const time = (ts: number) =>
    Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : "";
  try {
    for (const state of visual.states) {
      for (const [index, doc] of state.documents.entries()) {
        const key = `${state.id}:document-${index}`;
        const asset = assets.get(doc.key);
        if (!asset) {
          warnings.push(`${key}: captured document is missing.`);
          continue;
        }
        documents.push({
          id: key,
          title:
            state.title +
            (doc.key === state.root ? "" : ` · Embedded document ${index + 1}`),
          url: doc.url,
          capture: `Capture ${state.index + 1}`,
          time: state.time,
          html: new TextDecoder().decode(asset.bytes),
        });
        origins.set(key, state);
      }
    }
    if (!documents.length) {
      const coll = await open();
      if (!coll) throw new Error("Saved archive is unavailable.");
      const pages = ((await coll.store.getAllPages()) as SavedPage[]).sort(
        (a, b) => (a.ts || 0) - (b.ts || 0),
      );
      if (pages.length > 2000)
        throw new OperationError("EXPORT_TOO_LARGE", "Too many saved pages.");
      for (const [i, page] of pages.entries()) {
        progress({ phase: "reading-text", done: i, total: pages.length });
        const resource = await savedAsset(page.url, page.ts || 0);
        const html =
          resource?.mime.includes("html") &&
          resource.bytes.length <= 10 * 1024 * 1024
            ? new TextDecoder().decode(resource.bytes)
            : undefined;
        documents.push({
          id: `network-${i}`,
          title: page.title || "Untitled page",
          url: page.url,
          capture: `Visit ${i + 1}`,
          time: time(page.ts || 0),
          html,
          text: page.text,
        });
      }
      warnings.push(
        "No visual capture states were available. Saved page HTML/text is used; embedded or dynamic content may be incomplete.",
      );
    }
    const organized = organizeLearningDocuments(documents);
    documents = organized.documents;
    if (organized.missingOutline.length) {
      const labels = organized.missingOutline
        .map((item) => item.title)
        .filter(Boolean)
        .join(", ");
      warnings.push(
        `Course outline exposed ${organized.stats.detectedOutlineItems} sections, but ${organized.stats.capturedOutlineItems} had settled captured content. Missing from the learning notes: ${labels || `${organized.missingOutline.length} course section(s)`}. Revisit those sections and wait for them to settle before stopping the recording.`,
      );
    }
    const result = await buildLearningExport({
      title:
        organized.suggestedTitle ||
        title ||
        visual.states[0]?.title ||
        collection?.config.metadata?.title ||
        "Learning sources",
      documents,
      coverage: coverageText(coverage),
      warnings,
      organization: organized.stats,
      progress,
      resolveAsset: async (doc, url) => {
        const state = origins.get(doc.id);
        const asset = state && assets.get(state.refs[url]);
        if (asset) return asset;
        return savedAsset(url, Date.parse(doc.time) || 0);
      },
    });
    return {
      blob: result.blob,
      filename:
        "PageTrail-" + id.replace(/[^a-zA-Z0-9_-]/g, "") + "-learning.zip",
      missing: result.missing + coverageGaps(coverage),
    };
  } finally {
    collection?.store.close();
  }
}
