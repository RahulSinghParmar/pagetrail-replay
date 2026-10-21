// SPDX-License-Identifier: AGPL-3.0-or-later
import { inScope, scopePath } from "./scope";
import { sensitiveEndpoint } from "./privacy";

export type CrawlConfig = {
  sessionId: string;
  origin: string;
  path: string;
  seed: string;
  maxPages: number;
  maxDepth: number;
};
export type CrawlPage = {
  url: string;
  depth: number;
  state: "queued" | "active" | "visited" | "failed";
};
export type CrawlState = {
  config: CrawlConfig;
  state: "RUNNING" | "PAUSED" | "STOPPED" | "DONE" | "LIMIT" | "ERROR";
  pages: CrawlPage[];
  attempts: number;
  skipped: number;
  elapsedMs: number;
  notice: string;
};
// Conservative link policy, not a guarantee that GET requests are side-effect free.
const ACTION =
  /(?:^|[\W_])(?:logout|signout|login|signin|delete|remove|submit|complete|completion|launch|enroll|unenroll|purchase|checkout|payment|quiz|assessment|exam|attempt|reset|unsubscribe)(?:$|[\W_])/i;
export function crawlUrl(
  raw: string,
  base: string,
  config: Pick<CrawlConfig, "origin" | "path">,
): string | null {
  try {
    if (raw.length > 2048) return null;
    const url = new URL(raw, base);
    if (
      !inScope(config.origin, url.href, config.path) ||
      sensitiveEndpoint(url.href)
    )
      return null;
    const decoded = decodeURIComponent(url.pathname + url.search);
    if (
      ACTION.test(decoded) ||
      /(?:^|[?&])(?:action|token|code|password|signature|redirect|returnurl|sessionid)=/i.test(
        decoded,
      )
    )
      return null;
    if (
      /\.(?:pdf|zip|wacz|exe|dmg|mp[34]|webm|png|jpe?g|gif|svg|css|js)$/i.test(
        url.pathname,
      )
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
export function crawlConfig(input: CrawlConfig): CrawlConfig {
  if (!input.path.trim())
    throw new Error(
      "Choose a crawl path. Use / only to include this entire exact site.",
    );
  const path = scopePath(input.path) || "/";
  const origin = new URL(input.origin).origin;
  const config = { ...input, path, origin };
  if (
    !Number.isInteger(input.maxPages) ||
    input.maxPages < 1 ||
    input.maxPages > 50 ||
    !Number.isInteger(input.maxDepth) ||
    input.maxDepth < 0 ||
    input.maxDepth > 3
  )
    throw new Error("Choose 1–50 pages and a link depth of 0–3.");
  const seed = crawlUrl(input.seed, input.seed, config);
  if (!seed)
    throw new Error(
      "The current page cannot be crawled within this boundary. Choose a normal content page.",
    );
  return { ...config, seed };
}

export function createCrawler(deps: {
  load(): Promise<CrawlState | null>;
  save(state: CrawlState): Promise<void>;
  visit(
    url: string,
    config: CrawlConfig,
    signal: AbortSignal,
  ): Promise<{ url: string; links: string[] }>;
  release(): Promise<void>;
}) {
  let state: CrawlState | null = null;
  let abort: AbortController | undefined;
  let job: Promise<void> | undefined;
  let commands: Promise<unknown> = Promise.resolve();
  const copy = () => (state ? structuredClone(state) : null);
  const save = async () => {
    if (state) await deps.save(structuredClone(state));
  };
  const ready = (async () => {
    state = await deps.load();
    if (state?.state === "RUNNING") {
      state.state = "PAUSED";
      state.notice =
        "Crawl interrupted. Resume recording, then resume crawling explicitly.";
      for (const page of state.pages)
        if (page.state === "active") page.state = "queued";
      await save();
    }
  })();
  const launch = () => {
    abort = new AbortController();
    const signal = abort.signal;
    job = (async () => {
      try {
        while (state?.state === "RUNNING" && !signal.aborted) {
          const page = state.pages.find((item) => item.state === "queued");
          if (!page) {
            state.state = "DONE";
            state.notice =
              "Crawl finished within the selected depth. Review failed pages and capture coverage before export.";
            break;
          }
          if (
            state.attempts >= state.config.maxPages ||
            state.elapsedMs >= 600000
          ) {
            state.state = "LIMIT";
            state.notice =
              "Crawl limit reached. Saved pages remain available; review coverage before export.";
            break;
          }
          page.state = "active";
          state.attempts++;
          await save(); // Persist intent before navigating.
          if (signal.aborted) {
            page.state = "queued";
            break;
          }
          const began = Date.now();
          try {
            const result = await deps.visit(page.url, state.config, signal);
            if (signal.aborted) {
              page.state = "queued";
              break;
            }
            const final = crawlUrl(result.url, page.url, state.config);
            if (!final) throw new Error("Page left the crawl boundary.");
            page.state = "visited";
            const known = new Set(state.pages.map((item) => item.url));
            known.add(final);
            const redirected = state.pages.find(
              (item) => item.url === final && item.state === "queued",
            );
            if (redirected) redirected.state = "visited";
            if (page.depth < state.config.maxDepth) {
              for (const raw of result.links.slice(0, 1000)) {
                const url = crawlUrl(raw, final, state.config);
                if (!url) {
                  state.skipped++;
                  continue;
                }
                if (known.has(url)) continue;
                if (state.pages.length >= 200) {
                  state.skipped++;
                  continue;
                }
                known.add(url);
                state.pages.push({
                  url,
                  depth: page.depth + 1,
                  state: "queued",
                });
              }
            }
          } catch {
            page.state = signal.aborted ? "queued" : "failed";
            if (!signal.aborted) {
              state.state = "PAUSED";
              state.notice =
                "A page failed, timed out or changed unexpectedly. Check the recording tab and coverage, then resume or stop.";
            }
          } finally {
            state.elapsedMs += Date.now() - began;
          }
          await save();
        }
      } catch {
        if (state) {
          state.state = "ERROR";
          state.notice =
            "Crawl state could not be saved. No further pages will be opened.";
        }
      } finally {
        try {
          await deps.release();
        } catch {
          if (state) {
            state.state = "ERROR";
            state.notice =
              "Could not restore recording controls. Finish the recording before continuing.";
          }
        }
        await save().catch(() => {});
      }
    })();
  };
  async function halt(next: "PAUSED" | "STOPPED") {
    abort?.abort();
    await job;
    job = undefined;
    if (!state) return;
    if (state.state === "ERROR") return;
    state.state = next;
    state.notice =
      next === "PAUSED"
        ? "Crawl paused. No further pages will be opened."
        : "Crawl stopped. Saved pages remain in the recording.";
    await save();
  }
  return {
    async status() {
      await ready;
      return copy();
    },
    async command(
      action: "start" | "pause" | "resume" | "stop",
      config?: CrawlConfig,
    ) {
      const result = commands.then(async () => {
        await ready;
        if (action === "pause" || action === "stop")
          await halt(action === "pause" ? "PAUSED" : "STOPPED");
        else {
          if (state?.state === "RUNNING")
            throw new Error("A crawl is already running.");
          await job;
          if (state?.state === "ERROR") await deps.release();
          if (action === "start") {
            if (!config) throw new Error("Crawl settings are required.");
            const checked = crawlConfig(config);
            state = {
              config: checked,
              state: "RUNNING",
              pages: [{ url: checked.seed, depth: 0, state: "queued" }],
              attempts: 0,
              skipped: 0,
              elapsedMs: 0,
              notice:
                "Following links in the recording tab. Leave this tab to the crawler until it pauses or finishes.",
            };
          } else {
            if (state?.state !== "PAUSED")
              throw new Error("Only a paused crawl can resume.");
            state.state = "RUNNING";
            state.notice = "Continuing the remaining crawl queue.";
          }
          try {
            await save();
          } catch (error) {
            state.state = "ERROR";
            state.notice =
              "Crawl settings could not be saved. No pages were opened.";
            throw error;
          }
          launch();
        }
        return copy();
      });
      commands = result.catch(() => {});
      return result;
    },
    async idle() {
      await job;
    },
  };
}
