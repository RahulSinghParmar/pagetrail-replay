// SPDX-License-Identifier: AGPL-3.0-or-later
// Test-only HTTP adapter. Production queue/storage/export; no real debugger capture.
import { CollectionLoader } from "@webrecorder/wabac/swlib";
import { createCrawler, type CrawlState } from "./crawl";
import { createLocalExport } from "./export";
import { saveLocalFile } from "./download";
const loader = new CollectionLoader();
let coll: Awaited<ReturnType<typeof loader.initNewColl>> | null = null;
const status = document.getElementById("crawl-status")!;
const list = document.getElementById("crawl-pages")!;
const key = "phase4-sample-crawl";
function render(state: CrawlState | null) {
  if (!state) return;
  status.textContent = `${state.state} · ${
    state.pages.filter((p) => p.state === "visited").length
  } visited · ${
    state.pages.filter((p) => p.state === "queued").length
  } queued · ${
    state.pages.filter((p) => p.state === "failed").length
  } failed · ${state.skipped} skipped. ${state.notice}`;
  list.replaceChildren(
    ...state.pages.map((page) => {
      const item = document.createElement("li");
      item.textContent = `${page.state} · ${
        new URL(page.url).pathname
      } · depth ${page.depth}`;
      return item;
    }),
  );
  for (const action of ["start", "pause", "resume", "stop", "export"]) {
    const enabled =
      action === "start"
        ? state.state !== "RUNNING"
        : action === "pause"
          ? state.state === "RUNNING"
          : action === "resume"
            ? state.state === "PAUSED"
            : action === "stop"
              ? ["RUNNING", "PAUSED"].includes(state.state)
              : state.state !== "RUNNING";
    (document.getElementById(action) as HTMLButtonElement).disabled = !enabled;
  }
}
const crawler = createCrawler({
  load: async () => JSON.parse(localStorage.getItem(key) || "null"),
  save: async (state) => {
    localStorage.setItem(key, JSON.stringify(state));
    render(state);
  },
  visit: async (url, config, signal) => {
    if (!coll || coll.name !== config.sessionId)
      coll = await loader.loadColl(config.sessionId);
    if (!coll) throw new Error("Missing sample archive.");
    const store = coll.store;
    await store.initing;
    const response = await fetch(url, { signal, redirect: "error" });
    if (!response.ok) throw new Error("Sample page unavailable.");
    const html = await response.text();
    const dom = new DOMParser().parseFromString(html, "text/html");
    const ts = Date.now(),
      id = crypto.randomUUID();
    const save = async (source: string, text: string, mime: string) => {
      const payload = new TextEncoder().encode(text);
      await store.addResource({
        url: source,
        ts,
        status: 200,
        mime,
        payload,
        respHeaders: { "content-type": mime + ";charset=utf-8" },
        reqHeaders: {},
        pageId: id,
      });
    };
    await save(url, html, "text/html");
    for (const node of dom.querySelectorAll(
      'link[rel="stylesheet"][href],img[src]',
    )) {
      const asset = new URL(
        node.getAttribute("href") || node.getAttribute("src")!,
        url,
      );
      if (
        asset.origin !== location.origin ||
        !["/sample/style.css", "/sample/logo.svg"].includes(asset.pathname)
      )
        continue;
      const resource = await fetch(asset.href, { signal, redirect: "error" });
      if (!resource.ok) throw new Error("Sample asset unavailable.");
      await save(
        asset.href,
        await resource.text(),
        resource.headers.get("content-type")!.split(";")[0],
      );
    }
    await store.addPage({
      id,
      url,
      ts,
      title: dom.title,
      text: dom.body.textContent || "",
    });
    return {
      url,
      links: [...dom.querySelectorAll("a[href]:not([download])")].map(
        (a) => new URL(a.getAttribute("href")!, url).href,
      ),
    };
  },
  release: async () => {
    coll?.store.close();
    coll = null;
  },
});
for (const action of ["start", "pause", "resume", "stop", "export"])
  document.getElementById(action)!.addEventListener("click", () => {
    void (async () => {
      if (action === "start") {
        coll = await loader.initNewColl({
          title: "Phase 4 · fresh crawled sample",
        });
        await crawler.command("start", {
          sessionId: coll.name,
          origin: location.origin,
          path: "/sample",
          seed: location.origin + "/sample",
          maxPages: 20,
          maxDepth: 2,
        });
      } else if (action === "export") {
        const state = await crawler.status();
        if (!state) return;
        const file = await createLocalExport(state.config.sessionId, "wacz");
        await saveLocalFile(file.blob, file.filename);
        document.getElementById("export-result")!.textContent =
          `Saved ${file.filename} · ${file.blob.size} bytes`;
      } else await crawler.command(action as "pause" | "resume" | "stop");
    })().catch((error) => {
      status.textContent = "Test error: " + String(error);
    });
  });
void crawler.status().then(render);
