// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import { CollectionLoader } from "@webrecorder/wabac/swlib";
import { Downloader, type DBCollection } from "../sw/downloader";
import {
  collectReadingBook,
  readingHtml,
  readingMarkdown,
  type SavedPage,
} from "./reading";
import { responseBlob } from "./download";
import type { ExportFormat, ExportProgress } from "./export-protocol";
import { readCoverage } from "./coverage-store";
import { coverageText, coverageGaps } from "./coverage";
export async function createLegacyExport(
  id: string,
  format: ExportFormat,
  progress: (value: ExportProgress) => void = () => {},
): Promise<{ blob: Blob; filename: string; missing: number }> {
  const coll = (await new CollectionLoader().loadColl(
    id,
  )) as DBCollection | null;
  if (!coll)
    throw new Error(
      "The saved archive could not be found in this browser profile. No data was deleted.",
    );
  try {
    const coverage = (await readCoverage(id))?.summary;
    await coll.store.initing;
    const filename = "PageTrail-" + id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (format === "wacz") {
      progress({ phase: "building" });
      const downloader = new Downloader({
        coll,
        format: "wacz",
        filename,
        softwareString: "PageTrail Replay local export 0.1.2",
      });
      // Keep coverage inside the one-file archive too. Replace only the
      // exporter's metadata copy, never the original collection metadata.
      downloader.metadata = {
        ...downloader.metadata,
        desc:
          (downloader.metadata.desc || "") +
          "\n\nPageTrail capture coverage: " +
          coverageText(coverage),
      };
      const response = await downloader.download();
      if (!(response instanceof Response))
        throw new Error(
          "WACZ export failed. Try a reading export; the archive is unchanged.",
        );
      return {
        blob: await responseBlob(response, (bytes) =>
          progress({ phase: "building", bytes }),
        ),
        filename: filename + ".wacz",
        missing: coverageGaps(coverage),
      };
    }
    progress({ phase: "reading-text" });
    const pages = (await coll.store.getAllPages()) as SavedPage[];
    const book = await collectReadingBook(
      coll.config.metadata?.title || "Captured reading",
      pages,
      async (page) => {
        const resource = await coll.store.lookupUrl(page.url, page.ts || 0);
        if (!resource || !resource.mime?.includes("html")) return null;
        const payload = await coll.store.loadPayload(resource, {});
        if (!(payload instanceof Uint8Array)) return null;
        if (payload.byteLength > 10 * 1024 * 1024) return null;
        return new TextDecoder().decode(payload);
      },
    );
    const content =
      format === "reading"
        ? readingHtml({ ...book, coverage: coverageText(coverage) })
        : readingMarkdown({ ...book, coverage: coverageText(coverage) });
    const response = new Response(content, {
      headers: {
        "Content-Type":
          format === "reading"
            ? "text/html;charset=utf-8"
            : "text/markdown;charset=utf-8",
      },
    });
    return {
      blob: await responseBlob(response),
      filename: filename + (format === "reading" ? "-text.html" : ".md"),
      missing: book.missing.length + coverageGaps(coverage),
    };
  } finally {
    coll.store.close();
  }
}
