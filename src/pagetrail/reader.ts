// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import { html } from "lit";
import { ReplayWebApp, type Chooser, type Item } from "replaywebpage";
import {
  localArchiveSource,
  localImportOptions,
  localCollectionId,
  REPLAY_BUILD,
} from "./replay-policy";

class PageTrailReader extends ReplayWebApp {
  browse = false;
  override get appName() {
    return "PageTrail";
  }
  override firstUpdated() {
    this.initRoute();
    if (!navigator.serviceWorker) {
      this.swErrorMsg =
        "This browser cannot start offline replay here. Use Edge or Chrome with the local reader server running.";
      return;
    }
    // Register the specific reader worker, never update a previously installed
    // recorder worker by mistake. Bypass the HTTP cache for in-place upgrades.
    void navigator.serviceWorker
      .register("./reader-sw.js?serveIndex=1", {
        scope: "./",
        updateViaCache: "none",
      })
      .then((registration) => registration.update())
      .catch(() => {
        this.swErrorMsg =
          "The local replay worker could not start. Keep the recording, restart the local reader and reload this tab.";
      });
    window.addEventListener("popstate", () => this.initRoute());
  }
  override initRoute() {
    // Ignore remote sources, live proxies and custom SW/config in reader links.
    const url = new URL(window.location.href);
    const source = url.searchParams.get("source");
    url.search = "";
    if (source && localArchiveSource(source, url.href))
      url.searchParams.set(
        "source",
        source.startsWith("file://") ? source : new URL(source, url.href).href,
      );
    url.searchParams.set("embed", "replayonly");
    if (!url.hash) url.hash = "url=page%3A0";
    window.history.replaceState({}, "", url);
    this.pageParams = url.searchParams;
    this.skipRuffle = true;
    this.loadInfo = null;
    super.initRoute();
    // A fully imported archive is keyed by the native collection ID, not the
    // generic URL hash used for lazily streamed HTTP/file sources.
    const importedId = source ? localCollectionId(source) : null;
    if (importedId) this.loadInfo = { customColl: importedId };
    this.swName = "reader-sw.js";
  }
  override renderHomeIndex() {
    return html`<p style="padding:48px;text-align:center">
        Open a recording above, then browse using the website’s own links and
        buttons.
      </p>
      <wr-chooser
        style="display:none"
        @load-start=${this.onStartLoad}
      ></wr-chooser>`;
  }
  override onStartLoad(event: CustomEvent) {
    if (event.detail?.isFile) Object.assign(event.detail, localImportOptions());
    super.onStartLoad(event);
  }
  override renderColl() {
    return html`<wr-item
      .loadInfo=${this.loadInfo}
      .sourceUrl=${this.sourceUrl || ""}
      embed="replayonly"
      .showSidebar=${this.browse}
      .embedOpts=${{ noMediaDownloadUI: true, hideMetadataSidebar: true }}
      appName="PageTrail"
      swName="reader-sw.js"
      @coll-loaded=${this.onCollLoaded}
      @coll-load-cancel=${() => {
        this.sourceUrl = null;
      }}
      @update-title=${this.onTitle}
    ></wr-item>`;
  }
  currentItem() {
    return this.shadowRoot?.querySelector<Item>("wr-item");
  }
  override onCollLoaded(event: CustomEvent) {
    super.onCollLoaded(event);
    this.dispatchEvent(new Event("reader-ready"));
  }
  togglePages() {
    this.browse = !this.browse;
    this.requestUpdate();
  }
}
customElements.define("pagetrail-reader", PageTrailReader);

window.addEventListener("DOMContentLoaded", () => {
  const app = document.querySelector<PageTrailReader>("pagetrail-reader");
  const input = document.querySelector<HTMLInputElement>("#local-archive");
  const notice = document.getElementById("local-notice");
  const pages = document.querySelector<HTMLButtonElement>("#recorded-pages");
  if (!app || !input || !notice || !pages) return;
  if (!navigator.serviceWorker) {
    input.disabled = true;
    notice.textContent =
      "Offline replay needs a browser with service workers and the local reader server. Direct file opening is not supported.";
    return;
  }
  let engineStatus = document.getElementById("engine-status");
  // An older SW may still serve the previous HTML shell during an upgrade.
  if (!engineStatus) {
    engineStatus = document.createElement("small");
    engineStatus.id = "engine-status";
    document.getElementById("local-toolbar")?.append(engineStatus);
  }
  let engineReady = false;
  const engineDeadline = window.setTimeout(() => {
    if (!engineReady && engineStatus)
      engineStatus.textContent =
        "Reader upgrade pending: close all reader tabs and reopen. Do not clear storage.";
  }, 5000);
  const checkEngine = () =>
    navigator.serviceWorker.controller?.postMessage({
      type: "pagetrail-reader-status",
    });
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    if (
      event.source === navigator.serviceWorker.controller &&
      event.data?.type === "pagetrail-reader-status" &&
      event.data.build === REPLAY_BUILD &&
      engineStatus
    ) {
      engineReady = true;
      window.clearTimeout(engineDeadline);
      engineStatus.textContent = event.data.build;
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", checkEngine);
  void navigator.serviceWorker.ready.then(checkEngine);
  input.addEventListener("change", () => {
    void (async () => {
      const file = input.files?.[0];
      if (!file) return;
      input.value = "";
      if (!/\.(wacz(?:\.zip)?|warc(?:\.gz)?|har)$/i.test(file.name))
        throw new Error("Unsupported archive.");
      // Switching does not delete imported archives or recorder storage.
      app.sourceUrl = null;
      app.loadInfo = null;
      app.browse = false;
      const url = new URL(window.location.href);
      url.search = "?embed=replayonly";
      url.hash = "url=page%3A0";
      window.history.replaceState({}, "", url);
      app.pageParams = url.searchParams;
      await app.updateComplete;
      const chooser = app.shadowRoot?.querySelector<Chooser>("wr-chooser");
      if (!chooser)
        throw new Error("Reader not ready. Reload and choose the file again.");
      // Public component property: follows exactly the upstream drag-and-drop import path.
      chooser.droppedFile = file;
      notice.textContent = "Opening " + file.name + " locally…";
      pages.setAttribute("aria-pressed", "false");
    })().catch(() => {
      notice.textContent =
        "Could not open the recording. Reload and choose a supported archive.";
    });
  });
  document
    .getElementById("reader-back")
    ?.addEventListener("click", () => window.history.back());
  document
    .getElementById("reader-forward")
    ?.addEventListener("click", () => window.history.forward());
  document
    .getElementById("reader-reload")
    ?.addEventListener("click", () => app.currentItem()?.onRefresh(null, true));
  pages.addEventListener("click", () => {
    app.togglePages();
    pages.setAttribute("aria-pressed", String(app.browse));
  });
  app.addEventListener("reader-ready", () => {
    notice.textContent =
      "Offline replay · original links and recorded responses · missing content stays unavailable.";
  });
});
