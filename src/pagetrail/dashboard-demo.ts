// SPDX-License-Identifier: AGPL-3.0-or-later
// Test-only adapter: production UI, real IndexedDB/worker/exporter; invented content.
import { CollectionLoader } from "@webrecorder/wabac/swlib";
import { mountDashboard, type LibraryStatus } from "./dashboard-app";
import { saveCapture, visualMeta } from "./visual-store";
import { fixtureCapture } from "./visual-fixture";
import { runExportJob } from "./export-job";
import { confirmedDownload, saveLocalFile } from "./download";
const bar = document.createElement("section");
bar.className = "card";
bar.setAttribute("aria-label", "Synthetic test controls");
const heading = document.createElement("strong"),
  note = document.createElement("p"),
  large = document.createElement("button"),
  mode = document.createElement("select");
heading.textContent = "Synthetic acceptance test · not your Edge recording";
note.id = "fixture-status";
note.textContent = "Preparing real local test data…";
large.textContent = "Add 160-state stress session";
mode.setAttribute("aria-label", "Test scenario");
for (const [value, text] of [
  ["normal", "Normal export"],
  ["status", "Recorder reply stalls"],
  ["worker", "Worker never responds"],
  ["dialog", "Save dialog never finishes"],
]) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  mode.append(option);
}
bar.append(heading, note, large, mode);
document.querySelector("main")!.prepend(bar);
const archives: LibraryStatus["archives"] = [];
async function seed(count: number, padded: boolean) {
  const loader = new CollectionLoader(),
    coll = await loader.initNewColl({
      title: padded
        ? "Stress fixture · 160 states"
        : "Tools lesson · synthetic",
    });
  coll.store.close();
  const id = coll.name;
  for (let index = 0; index < count; index++) {
    const padding = padded
      ? `Practice line ${index}: inspect, identify, verify. `.repeat(6000)
      : "";
    await saveCapture(id, fixtureCapture((index % 2) + 1, "fixture", padding), {
      url: "https://fixture.example/player",
      title: "Synthetic lesson " + (index + 1),
    });
    if (padded && index % 10 === 0)
      note.textContent = `Seeding stress fixture: ${index + 1} / ${count}`;
  }
  archives.push({
    id,
    title: padded ? "Stress fixture · 160 states" : "Tools lesson · synthetic",
    bytes: 0,
    visual: await visualMeta(id),
  });
  if (loader.colldb) loader.colldb.close();
}
void seed(2, false)
  .then(() => {
    note.textContent =
      "Ready. UI and background worker are production code; recorder replies and timeout cases use this explicit test adapter.";
    const app = mountDashboard({
      statusMs: 1200,
      status: async () =>
        mode.value === "status"
          ? new Promise(() => {})
          : { session: null, archives },
      export: (request, options) =>
        runExportJob(
          request,
          mode.value === "worker"
            ? {
                ...options,
                idleMs: 1200,
                worker: () =>
                  new Worker(new URL("./stall-worker.ts", import.meta.url)),
              }
            : options,
        ),
      save: (blob, filename, options) =>
        mode.value === "dialog"
          ? confirmedDownload(
              blob,
              filename,
              {
                download: () => new Promise(() => {}),
                search: () => Promise.resolve([]),
              },
              { ...options, dialogMs: 1200 },
            ).then(() => "complete")
          : saveLocalFile(blob, filename, options),
    });
    large.onclick = () => {
      large.disabled = true;
      void seed(160, true)
        .then(() => {
          note.textContent =
            "Stress data ready: 160 changed states, shared styles/image, roughly 45 MB captured HTML. No real website data.";
          return app.refresh();
        })
        .catch(() => {
          note.textContent =
            "Stress fixture could not be created (local storage limit). Small fixture is preserved.";
        })
        .finally(() => {
          large.disabled = false;
        });
    };
  })
  .catch(() => {
    note.textContent = "Could not create synthetic fixture.";
  });
