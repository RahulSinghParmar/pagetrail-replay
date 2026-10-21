// SPDX-License-Identifier: AGPL-3.0-or-later
export type ExportFormat =
  | "html"
  | "reading"
  | "md"
  | "wacz"
  | "coverage"
  | "learning";
export type ExportPhase =
  | "checking"
  | "starting"
  | "opening"
  | "reading-states"
  | "reading-assets"
  | "embedding"
  | "reading-text"
  | "building"
  | "ready"
  | "save-dialog"
  | "downloading"
  | "complete";
export type ExportProgress = {
  phase: ExportPhase;
  done?: number;
  total?: number;
  bytes?: number;
};
export type ExportFile = { blob: Blob; filename: string; missing: number };
export type ExportRequest = {
  id: string;
  format: ExportFormat;
  title?: string;
};
export type ExportReply =
  | { kind: "progress"; value: ExportProgress }
  | { kind: "result"; value: ExportFile }
  | { kind: "error"; code: string };
export const phaseLabel = (progress: ExportProgress): string => {
  const labels: Record<ExportPhase, string> = {
    checking: "Checking the recording",
    starting: "Starting background export",
    opening: "Opening local storage",
    "reading-states": "Reading captured pages",
    "reading-assets": "Reading images, styles and fonts",
    embedding: "Building the single HTML",
    "reading-text": "Extracting captured text",
    building: "Preparing the file",
    ready: "File ready",
    "save-dialog": "Choose a location in the browser’s Save dialog",
    downloading: "Saving the file",
    complete: "Saved",
  };
  return (
    labels[progress.phase] +
    (progress.total ? ` · ${progress.done || 0} / ${progress.total}` : "")
  );
};
