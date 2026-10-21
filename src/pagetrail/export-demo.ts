// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic integration fixture: real IndexedDB + native exporter, never employer data.
import { CollectionLoader } from "@webrecorder/wabac/swlib";
import { runExportJob } from "./export-job";
import { phaseLabel, type ExportFormat } from "./export-protocol";
import { saveLocalFile } from "./download";
import { saveCapture, visualMeta } from "./visual-store";
import { fixtureCapture } from "./visual-fixture";
const notice = document.getElementById("notice")!;
const buttons = [
  ...document.querySelectorAll<HTMLButtonElement>("button[data-format]"),
];
let id = "";
async function seed() {
  const loader = new CollectionLoader();
  const coll = await loader.initNewColl({
    title: "Learning export · Synthetic fixture",
    size: 4096,
  });
  const ts = Date.now(),
    store = coll.store;
  await store.initing;
  const pages = [
    {
      id: "visit-one",
      url: "https://fixture.example/course?unit=1",
      title: "Completed tools lesson",
      text: "DOM_CAPTURE_ONLY: inspect tools before use.\nहिन्दी · café · 日本語",
      ts,
    },
    {
      id: "visit-two",
      url: "https://fixture.example/course?unit=1",
      title: "Completed tools lesson",
      text: "DOM_CAPTURE_ONLY: inspect tools before use.\nहिन्दी · café · 日本語\nNewly revealed revision point.",
      ts: ts + 1,
    },
    {
      id: "visit-three",
      url: "https://fixture.example/course?unit=2",
      title: "Cable labels",
      ts,
    },
  ];
  for (const page of pages) await store.addPage(page);
  const html =
    '<!doctype html><html><head><script>fetch("https://must-not-run.example/")</script></head><body><h1>Cable labels</h1><p>HTML_FALLBACK_ONLY: verify both ends.</p><p>Never import a password from an input field.</p><input value="DO_NOT_EXPORT"><p hidden>DO_NOT_EXPORT</p></body></html>';
  for (const url of new Set(pages.map((page) => page.url))) {
    const payload = new TextEncoder().encode(html);
    await store.addResource({
      url,
      ts,
      status: 200,
      mime: "text/html",
      payload,
      respHeaders: { "content-type": "text/html;charset=utf-8" },
      reqHeaders: {},
      pageId: "visit-three",
    });
  }
  store.close();
  id = coll.name;
  await saveCapture(id, fixtureCapture(1), {
    url: "https://fixture.example/player",
    title: "Tools · inspect before use",
  });
  await saveCapture(id, fixtureCapture(1, "different-generated-id"), {
    url: "https://fixture.example/player",
    title: "Tools · inspect before use",
  });
  if ((await visualMeta(id)).states !== 1)
    throw new Error("Unchanged page was incorrectly duplicated.");
  await saveCapture(
    id,
    fixtureCapture(2),
    { url: "https://fixture.example/player", title: "Tools · label both ends" },
    {
      from: 0,
      frame: "https://content.other.example/lesson",
      selector:
        "html:nth-of-type(1)>body:nth-of-type(1)>article:nth-of-type(1)>button:nth-of-type(1)",
      label: "Continue lesson",
    },
  );
  notice.textContent =
    "Ready: actual local IndexedDB contains two visual states at the same URL, each with an embedded cross-host lesson, shared stylesheet and shared illustration. An unchanged repeat capture was deduplicated. No service-worker download endpoint is used.";
  for (const button of buttons) button.disabled = false;
}
for (const button of buttons)
  button.addEventListener("click", () => {
    for (const item of buttons) item.disabled = true;
    void (async () => {
      const file = await runExportJob(
        { id, format: button.dataset.format as ExportFormat },
        {
          progress: (value) => {
            notice.textContent = phaseLabel(value);
          },
        },
      );
      await saveLocalFile(file.blob, file.filename);
      notice.textContent = `Local ${button.dataset.format} file generated: ${file.blob.size} bytes. Test browser requested a Blob download; check actual downloaded file.`;
    })()
      .catch((error) => {
        notice.textContent = String(error);
      })
      .finally(() => {
        for (const item of buttons) item.disabled = false;
      });
  });
void seed().catch((error) => {
  notice.textContent = String(error);
});
