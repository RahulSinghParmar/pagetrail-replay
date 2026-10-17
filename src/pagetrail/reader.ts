// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
// Registers the locally bundled reader and a standard file-input fallback.
import "replaywebpage";
import { type Chooser, type ReplayWebApp } from "replaywebpage";
window.addEventListener("DOMContentLoaded", () => {
  const input = document.querySelector<HTMLInputElement>("#local-archive");
  const notice = document.getElementById("local-notice");
  input?.addEventListener("change", () => {
    void (async () => {
      const file = input.files?.[0];
      if (!file) return;
      const app = document.querySelector<ReplayWebApp>("replay-app-main");
      if (!app)
        throw new Error("Reader did not initialize. Reload and try again.");
      if (app.sourceUrl)
        throw new Error(
          "Use ReplayWeb.page Home before choosing another archive.",
        );
      await app.updateComplete;
      const chooser = app.shadowRoot?.querySelector<Chooser>("wr-chooser");
      if (!chooser)
        throw new Error("Open the reader's Home page before choosing a file.");
      // Public component property: follows exactly the upstream drag-and-drop import path.
      chooser.droppedFile = file;
      if (notice)
        notice.textContent =
          "Opening " + file.name + " locally; nothing is uploaded.";
    })().catch((error: unknown) => {
      if (notice)
        notice.textContent =
          error instanceof Error
            ? error.message
            : "Could not open this archive.";
    });
  });
});
