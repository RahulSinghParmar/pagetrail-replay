// SPDX-License-Identifier: AGPL-3.0-or-later
import { bounded } from "./operations";
import { crawlUrl, type CrawlConfig } from "./crawl";

type Send = (
  method: string,
  params?: Record<string, unknown> | null,
  sessions?: never[],
) => Promise<TODOFixMe>;
type DriverDeps = {
  send: Send;
  pending(): number;
  capture(): Promise<void>;
  persist(): Promise<void>;
};
const INSPECT = `(()=>({url:location.href,ready:document.readyState,title:document.title,links:Array.from(document.querySelectorAll('a[href]:not([download])')).slice(0,1000).map(a=>a.href)}))()`;

// CDP adapter shared by the extension and injected-command regression tests.
export class CrawlDriver {
  config: CrawlConfig | null = null;
  private frameId = "";
  private blocked = false;
  private topRequests = 0;
  private readonly targets = new Map<string, never[]>();
  private readonly deps: DriverDeps;
  constructor(deps: DriverDeps) {
    this.deps = deps;
  }
  async target(sessions: never[]) {
    this.targets.set(sessions.join("/"), [...sessions]);
    if (this.config) await this.enable(sessions, true);
  }
  forget(sessions: never[]) {
    this.targets.delete(sessions.join("/"));
  }
  private async enable(sessions: never[], active: boolean) {
    await bounded(
      this.deps.send(
        "Fetch.enable",
        {
          patterns: [
            ...(active ? [{ urlPattern: "*", requestStage: "Request" }] : []),
            { urlPattern: "*", requestStage: "Response" },
          ],
        },
        sessions,
      ),
      { ms: 5000 },
    );
  }
  async paused(
    params: Record<string, TODOFixMe>,
    sessions: never[],
  ): Promise<boolean> {
    if (
      !this.config ||
      params.responseStatusCode !== undefined ||
      params.responseErrorReason !== undefined
    )
      return false;
    const top =
      !sessions.length &&
      params.resourceType === "Document" &&
      params.frameId === this.frameId;
    const method = String(params.request?.method || "");
    const allowed =
      ["GET", "HEAD", "OPTIONS"].includes(method) &&
      (!top ||
        (++this.topRequests <= 10 &&
          !!crawlUrl(
            String(params.request?.url || ""),
            this.config.seed,
            this.config,
          )));
    if (top && !allowed) this.blocked = true;
    await this.deps.send(
      allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
      {
        requestId: params.requestId,
        ...(allowed ? {} : { errorReason: "BlockedByClient" }),
      },
      sessions,
    );
    return true;
  }
  async visit(url: string, config: CrawlConfig, parentSignal: AbortSignal) {
    if (!crawlUrl(url, config.seed, config))
      throw new Error("Outside crawl boundary.");
    const began = performance.now();
    const timeout = new AbortController();
    const signal = timeout.signal;
    const cancel = () => timeout.abort();
    parentSignal.addEventListener("abort", cancel, { once: true });
    if (parentSignal.aborted) cancel();
    const timer = setTimeout(cancel, 30000);
    const check = () => {
      if (signal.aborted || performance.now() - began > 30000)
        throw new Error("Crawl page interrupted or timed out.");
      if (this.blocked)
        throw new Error("Navigation blocked by crawl boundary.");
    };
    const send = async (method: string, params?: Record<string, unknown>) => {
      check();
      const value = await bounded(this.deps.send(method, params), {
        signal,
        ms: 5000,
      });
      check();
      return value;
    };
    this.blocked = false;
    this.topRequests = 0;
    try {
      const tree = await send("Page.getFrameTree");
      this.frameId = tree.frameTree.frame.id;
      if (!this.config) {
        this.config = config;
        this.targets.set("", []);
        for (const sessions of this.targets.values()) {
          check();
          await this.enable(sessions, true);
        }
      }
      const nav = await send("Page.navigate", { url });
      if (nav.errorText || nav.isDownload)
        throw new Error("Page navigation failed.");
      let quiet = performance.now();
      let lastUrl = "";
      while (!signal.aborted) {
        check();
        const current = await send("Page.getFrameTree");
        if (nav.loaderId && current.frameTree.frame.loaderId !== nav.loaderId) {
          quiet = performance.now();
          await bounded(new Promise((resolve) => setTimeout(resolve, 150)), {
            signal,
            ms: 1000,
          });
          continue;
        }
        const world = await send("Page.createIsolatedWorld", {
          frameId: this.frameId,
          worldName: "pagetrail-crawl-links",
        });
        const data = await send("Runtime.evaluate", {
          expression: INSPECT,
          contextId: world.executionContextId,
          returnByValue: true,
        });
        const page = data.result?.value as
          | { url: string; ready: string; links: string[] }
          | undefined;
        if (!page || !crawlUrl(page.url, url, config))
          throw new Error("Crawl page unavailable or outside boundary.");
        if (
          page.ready !== "complete" ||
          this.deps.pending() ||
          page.url !== lastUrl
        )
          quiet = performance.now();
        lastUrl = page.url;
        if (performance.now() - quiet >= 1000) {
          await bounded(this.deps.capture(), { signal, ms: 16000 });
          check();
          await bounded(this.deps.persist(), { signal, ms: 5000 });
          check();
          return { url: page.url, links: page.links };
        }
        await bounded(new Promise((resolve) => setTimeout(resolve, 150)), {
          signal,
          ms: 1000,
        });
      }
      throw new Error("Crawl page interrupted.");
    } catch (error) {
      await bounded(this.deps.send("Page.stopLoading"), { ms: 2000 }).catch(
        () => {},
      );
      throw error;
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", cancel);
    }
  }
  async release() {
    if (!this.config) return;
    // Keep the request handler alive until interception has actually been restored.
    const results = await Promise.allSettled(
      [...this.targets.values()].map((target) => this.enable(target, false)),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Crawl guard cleanup failed.");
    this.config = null;
  }
}
