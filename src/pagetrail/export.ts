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
import { readVisualArchive } from "./visual-store";
import { visualHtml, visualReadingPages } from "./visual-html";
export type ExportFormat = "html" | "reading" | "md" | "wacz";
export async function createLocalExport(
  id: string,
  format: ExportFormat,
  progress: (text: string) => void = () => {},
): Promise<{ blob: Blob; filename: string; missing: number }> {
  const coll = (await new CollectionLoader().loadColl(
    id,
  )) as DBCollection | null;
  if (!coll)
    throw new Error(
      "The saved archive could not be found in this browser profile. No data was deleted.",
    );
  try {
    await coll.store.initing;
    const filename = "PageTrail-" + id.replace(/[^a-zA-Z0-9_-]/g, "");
    if (format === "wacz") {
      progress("Building WACZ directly from local storage…");
      const response = await new Downloader({
        coll,
        format: "wacz",
        filename,
        softwareString: "PageTrail Replay local export 0.1.2",
      }).download();
      if (!(response instanceof Response))
        throw new Error(
          "WACZ export failed. Try a reading export; the archive is unchanged.",
        );
      return {
        blob: await responseBlob(response, (bytes) =>
          progress(`Preparing local file: ${(bytes / 1048576).toFixed(1)} MB…`),
        ),
        filename: filename + ".wacz",
        missing: 0,
      };
    }
    const visual = await readVisualArchive(id);
    if (format === "html") {
      progress(
        "Embedding captured documents, frames, styles and images into one HTML…",
      );
      const result = visualHtml(
        visual,
        coll.config.metadata?.title || "Offline session",
      );
      return {
        blob: await responseBlob(
          new Response(result.html, {
            headers: { "Content-Type": "text/html;charset=utf-8" },
          }),
        ),
        filename: filename + ".html",
        missing: result.missing,
      };
    }
    progress("Reading saved page text. No live website is being fetched…");
    const pages = visual.states.length
      ? visualReadingPages(visual)
      : ((await coll.store.getAllPages()) as SavedPage[]);
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
      format === "reading" ? readingHtml(book) : readingMarkdown(book);
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
      missing: book.missing.length,
    };
  } finally {
    coll.store.close();
  }
}
