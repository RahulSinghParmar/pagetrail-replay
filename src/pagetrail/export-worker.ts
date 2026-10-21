// SPDX-License-Identifier: AGPL-3.0-or-later
import { createLocalExport } from "./export";
import type { ExportRequest, ExportReply } from "./export-protocol";
import { safeErrorCode } from "./operations";
const reply = (message: ExportReply) => self.postMessage(message);
self.onmessage = (event: MessageEvent<ExportRequest>) => {
  self.onmessage = null; // Exactly one task per dedicated worker; terminate after result.
  void createLocalExport(
    event.data.id,
    event.data.format,
    (value) => reply({ kind: "progress", value }),
    event.data.title,
  )
    .then((value) => reply({ kind: "result", value }))
    .catch((error) => reply({ kind: "error", code: safeErrorCode(error) }));
};
