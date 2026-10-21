// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import {
  createCrawler,
  crawlConfig,
  crawlUrl,
  type CrawlState,
  type CrawlConfig,
} from "../src/pagetrail/crawl.ts";
import { CrawlDriver } from "../src/pagetrail/crawl-driver.ts";
const config: CrawlConfig = {
  sessionId: "sample",
  origin: "https://sample.test",
  path: "/docs",
  seed: "https://sample.test/docs",
  maxPages: 20,
  maxDepth: 2,
};
test("crawl scope excludes sibling hosts, path escapes, actions and non-page links", () => {
  for (const url of [
    "https://other.sample.test/docs",
    "/docs-extra",
    "/docs/%2fadmin",
    "/docs/../account",
    "/docs/logout",
    "/docs/launch?course=2",
    "/docs/quiz",
    "/docs?q=submit",
    "/docs?action=save",
    "javascript:alert(1)",
    "https://user:pass@sample.test/docs",
    "/docs/guide.pdf",
    "/docs?token=secret",
  ])
    assert.equal(crawlUrl(url, config.seed, config), null, url);
  assert.equal(
    crawlUrl("/docs/tools?unit=2#tip", config.seed, config),
    "https://sample.test/docs/tools?unit=2",
  );
  for (const value of [
    { path: "" },
    { maxPages: 51 },
    { maxDepth: 4 },
    { path: "/outside" },
  ])
    assert.throws(() => crawlConfig({ ...config, ...value }));
});
function harness(
  visit: Parameters<typeof createCrawler>[0]["visit"],
  saved: CrawlState | null = null,
) {
  let stored = saved;
  let released = 0;
  const crawler = createCrawler({
    load: async () => stored,
    save: async (value) => {
      stored = structuredClone(value);
    },
    visit,
    release: async () => {
      released++;
    },
  });
  return { crawler, saved: () => stored, released: () => released };
}
test("crawl follows breadth-first links, deduplicates fragments and observes depth", async () => {
  const visits: string[] = [];
  const h = harness(async (url) => {
    visits.push(url);
    return {
      url,
      links:
        url === config.seed
          ? [
              "/docs/a#one",
              "/docs/a#two",
              "/docs/b",
              "/outside",
              "/docs/submit",
            ]
          : ["/docs/deep", "/docs"],
    };
  });
  await h.crawler.command("start", { ...config, maxDepth: 1 });
  await h.crawler.idle();
  assert.deepEqual(visits, [
    config.seed,
    config.seed + "/a",
    config.seed + "/b",
  ]);
  assert.equal(h.saved()?.state, "DONE");
  assert.equal(h.saved()?.skipped, 2);
  assert.equal(h.released(), 1);
});
test("crawl page cap and queue cap bound query-string traps", async () => {
  const h = harness(async (url) => ({
    url,
    links: Array.from({ length: 1000 }, (_, i) => `/docs?p=${i}`),
  }));
  await h.crawler.command("start", { ...config, maxPages: 2 });
  await h.crawler.idle();
  assert.equal(h.saved()?.state, "LIMIT");
  assert.equal(h.saved()?.attempts, 2);
  assert.equal(h.saved()?.pages.length, 200);
  assert((h.saved()?.skipped || 0) > 0);
});
test("pause aborts active work; resume continues queue; stop starts no new visits", async () => {
  let entered!: () => void;
  const active = new Promise<void>((r) => {
    entered = r;
  });
  let visits = 0;
  const h = harness(async (url, _, signal) => {
    visits++;
    if (visits === 1) {
      entered();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("abort")), {
          once: true,
        }),
      );
    }
    return { url, links: [] };
  });
  await h.crawler.command("start", config);
  await active;
  await h.crawler.command("pause");
  assert.equal(h.saved()?.state, "PAUSED");
  assert.equal(h.saved()?.pages[0].state, "queued");
  await h.crawler.command("resume");
  await h.crawler.idle();
  assert.equal(h.saved()?.state, "DONE");
  await h.crawler.command("stop");
  assert.equal(visits, 2);
});
test("restart retains queue but requires explicit resume", async () => {
  const h = harness(async (url) => ({ url, links: [] }), {
    config,
    state: "RUNNING",
    pages: [{ url: config.seed, depth: 0, state: "active" }],
    attempts: 1,
    elapsedMs: 0,
    skipped: 0,
    notice: "",
  });
  assert.equal((await h.crawler.status())?.state, "PAUSED");
  assert.equal(h.saved()?.pages[0].state, "queued");
  await h.crawler.command("resume");
  await h.crawler.idle();
  assert.equal(h.saved()?.state, "DONE");
});
test("failed pages pause rather than silently certify a complete crawl", async () => {
  const h = harness(async () => {
    throw new Error("page timeout");
  });
  await h.crawler.command("start", config);
  await h.crawler.idle();
  assert.equal(h.saved()?.state, "PAUSED");
  assert.equal(h.saved()?.pages[0].state, "failed");
  assert.equal(h.released(), 1);
});
test("storage failure stops before the next navigation", async () => {
  let writes = 0,
    visits = 0;
  const crawler = createCrawler({
    load: async () => null,
    save: async () => {
      if (++writes >= 2) throw new Error("quota");
    },
    visit: async (url) => {
      visits++;
      return { url, links: [] };
    },
    release: async () => {},
  });
  await crawler.command("start", config);
  await crawler.idle();
  assert.equal(visits, 0);
  assert.equal((await crawler.status())?.state, "ERROR");
});
test("CDP crawl guard blocks top-level escape, actions and write methods, preserves response capture", async () => {
  const commands: { method: string; params: any }[] = [];
  const driver = new CrawlDriver({
    send: async (method, params) => {
      commands.push({ method, params });
      return {};
    },
    pending: () => 0,
    capture: async () => {},
    persist: async () => {},
  });
  // Set frame identity through the public adapter's initial frame-tree call.
  const initialized = new CrawlDriver({
    send: async (method, params) => {
      commands.push({ method, params });
      if (method === "Page.getFrameTree")
        return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.navigate")
        throw new Error("fixture navigation ends setup");
      return {};
    },
    pending: () => 0,
    capture: async () => {},
    persist: async () => {},
  });
  await assert.rejects(
    initialized.visit(config.seed, config, new AbortController().signal),
  );
  const request = (url: string, method = "GET", frameId = "top") => ({
    requestId: "r",
    resourceType: "Document",
    frameId,
    request: { url, method },
  });
  await initialized.paused(request("https://outside.test/docs"), []);
  assert.equal(commands.at(-1)?.method, "Fetch.failRequest");
  await initialized.paused(request("https://sample.test/docs/complete"), []);
  assert.equal(commands.at(-1)?.method, "Fetch.failRequest");
  await initialized.paused(request(config.seed, "POST", "child"), []);
  assert.equal(commands.at(-1)?.method, "Fetch.failRequest");
  await initialized.paused(
    request("https://cdn.test/frame", "GET", "child"),
    [],
  );
  assert.equal(commands.at(-1)?.method, "Fetch.continueRequest");
  assert.equal(
    await initialized.paused(
      { ...request(config.seed), responseStatusCode: 200 },
      [],
    ),
    false,
  );
  await initialized.release();
  assert.deepEqual(commands.at(-1)?.params.patterns, [
    { urlPattern: "*", requestStage: "Response" },
  ]);
  assert.equal(driver.config, null);
});
test("CDP cancellation stops loading and never captures a partially loaded page", async () => {
  const abort = new AbortController();
  const calls: string[] = [];
  const driver = new CrawlDriver({
    send: async (method) => {
      calls.push(method);
      if (method === "Page.getFrameTree")
        return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.navigate") abort.abort();
      return {};
    },
    pending: () => 0,
    capture: async () => {
      calls.push("capture");
    },
    persist: async () => {},
  });
  await assert.rejects(driver.visit(config.seed, config, abort.signal));
  assert(calls.includes("Page.stopLoading"));
  assert(!calls.includes("capture"));
  await driver.release();
});

test("CDP waits for the committed document and quiet capture before discovering links", async () => {
  const calls: string[] = [];
  let treeReads = 0;
  const driver = new CrawlDriver({
    send: async (method) => {
      calls.push(method);
      if (method === "Page.getFrameTree")
        return {
          frameTree: {
            frame: { id: "top", loaderId: ++treeReads < 3 ? "old" : "new" },
          },
        };
      if (method === "Page.navigate") return { loaderId: "new" };
      if (method === "Page.createIsolatedWorld")
        return { executionContextId: 123 };
      if (method === "Runtime.evaluate")
        return {
          result: {
            value: { url: config.seed, ready: "complete", links: ["/docs/a"] },
          },
        };
      return {};
    },
    pending: () => 0,
    capture: async () => {
      calls.push("capture");
    },
    persist: async () => {
      calls.push("persist");
    },
  });
  const result = await driver.visit(
    config.seed,
    config,
    new AbortController().signal,
  );
  assert.deepEqual(result.links, ["/docs/a"]);
  assert.deepEqual(calls.slice(-2), ["capture", "persist"]);
  assert(treeReads >= 3);
  assert(!calls.includes("Page.stopLoading"));
  await driver.release();
});

test("initial persistence failure cannot leave a running crawl with no worker", async () => {
  let visits = 0;
  const crawler = createCrawler({
    load: async () => null,
    save: async () => {
      throw new Error("quota");
    },
    visit: async (url) => {
      visits++;
      return { url, links: [] };
    },
    release: async () => {},
  });
  await assert.rejects(crawler.command("start", config));
  assert.equal((await crawler.status())?.state, "ERROR");
  assert.equal(visits, 0);
});

test("finishing exactly at the page budget is DONE when no queue remains", async () => {
  const h = harness(async (url) => ({ url, links: [] }));
  await h.crawler.command("start", { ...config, maxPages: 1 });
  await h.crawler.idle();
  assert.equal(h.saved()?.state, "DONE");
});
