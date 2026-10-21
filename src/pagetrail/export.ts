// SPDX-License-Identifier: AGPL-3.0-or-later
import { readVisualArchive } from "./visual-store";
import { visualHtml, visualReadingPages } from "./visual-html";
import { collectReadingBook, readingHtml, readingMarkdown } from "./reading";
import { readCoverage } from "./coverage-store";
import { coverageText, coverageGaps } from "./coverage";
import type {
  ExportFile,
  ExportFormat,
  ExportProgress,
} from "./export-protocol";
export type { ExportFormat } from "./export-protocol";
export async function createLocalExport(
  id: string,
  format: ExportFormat,
  progress: (value: ExportProgress) => void = () => {},
  title?: string,
): Promise<ExportFile> {
  progress({ phase: "opening" });
  const coverage = await readCoverage(id, format === "coverage");
  const filename = "PageTrail-" + id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (format === "learning")
    return (await import("./learning-export")).createLearningExport(
      id,
      title,
      coverage?.summary,
      progress,
    );
  if (format === "coverage")
    return {
      blob: new Blob(
        [
          JSON.stringify(
            { schema: 1, notice: coverageText(coverage?.summary), ...coverage },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      filename: filename + "-coverage.json",
      missing: coverageGaps(coverage?.summary),
    };
  // Visual/text exports must not wait for the unrelated Webrecorder network DB.
  // Load its large archive engine only for WACZ or old text-only recordings.
  if (format === "wacz")
    return (await import("./export-legacy")).createLegacyExport(
      id,
      format,
      progress,
    );
  const visual = await readVisualArchive(id, {
    progress,
    documentsOnly: format !== "html",
  });
  const label = title || visual.states[0]?.title || "Offline session";
  if (format === "html") {
    const result = visualHtml(visual, label, {
      progress,
      coverage: coverageText(coverage?.summary),
    });
    progress({ phase: "building" });
    return {
      blob: new Blob([result.html], { type: "text/html;charset=utf-8" }),
      filename: filename + ".html",
      missing: result.missing + coverageGaps(coverage?.summary),
    };
  }
  if (!visual.states.length)
    return (await import("./export-legacy")).createLegacyExport(
      id,
      format,
      progress,
    );
  progress({ phase: "reading-text" });
  const pages = visualReadingPages(visual);
  const book = await collectReadingBook(label, pages, () =>
    Promise.resolve(null),
  );
  book.coverage = coverageText(coverage?.summary);
  progress({ phase: "building" });
  const html = format === "reading";
  const blob = new Blob([html ? readingHtml(book) : readingMarkdown(book)], {
    type: html ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8",
  });
  if (blob.size > 100 * 1024 * 1024) {
    const { OperationError } = await import("./operations");
    throw new OperationError(
      "EXPORT_TOO_LARGE",
      "The text export exceeds the 100 MB limit.",
    );
  }
  return {
    blob,
    filename: filename + (html ? "-text.html" : ".md"),
    missing: book.missing.length + coverageGaps(coverage?.summary),
  };
}
