// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import { CollectionLoader } from "@webrecorder/wabac/swlib";
import { LocalRecorder } from "./capture-recorder";
import { createSessionController } from "./session";
import { visualMeta } from "./visual-store";
import type { Session } from "./session";
import { recordDiagnostic } from "./diagnostics";
import { bounded, safeErrorCode } from "./operations";
import { CoverageLedger, coverageText } from "./coverage";
import { readCoverage, saveCoverage } from "./coverage-store";
import { createCrawler, type CrawlState } from "./crawl";
import { inScope, scopePath } from "./scope";

type Engine = LocalRecorder & {
  running?: boolean;
  stopping?: boolean;
  isAttached?: boolean;
  db: { close(): void } | null;
  getStatusMsg(): {
    sizeNew?: number;
    numUrls?: number;
    numPages?: number;
    numPending?: number;
  };
};

const loader = new CollectionLoader();
const RECORDERS: Record<string, Engine> = {};
self.recorders = RECORDERS;
const KEY = "pageTrailReplaySession";

const controller = createSessionController({
  load: async () => {
    const session: Session | null =
      (await chrome.storage.local.get(KEY))[KEY] || null;
    if (
      session &&
      ["STARTING", "RECORDING", "FINISHING"].includes(session.state)
    ) {
      try {
        await bounded(
          (async () => {
            const saved = await readCoverage(session.id, true);
            if (saved) {
              const recovered = new CoverageLedger(session.id, saved);
              recovered.finish(false);
              await saveCoverage(recovered.batch());
            }
          })(),
          { ms: 5000 },
        );
      } catch {
        void recordDiagnostic("capture", "CAPTURE_FAILED", {
          errorCode: "STORAGE_FAILED",
        });
      }
    }
    return session;
  },
  save: async (session) => {
    await chrome.storage.local.set({ [KEY]: session });
  },
  tab: async (id) => {
    const tab = await chrome.tabs.get(id);
    return { id, url: tab.url || "", title: tab.title };
  },
  now: () => new Date().toISOString(),
  create: async (title) => {
    const coll = await loader.initNewColl({ title });
    coll.store.close();
    return coll.name as string;
  },
  attach: async (session) => {
    await chrome.storage.local.set({
      archiveCookies: "0",
      archiveStorage: "0",
      archiveScreenshots: "0",
      archiveFlash: "0",
      autorunBehaviors: "0",
    });
    const previous = await readCoverage(session.id, true);
    const engine = new LocalRecorder(
      { tabId: session.tabId },
      { collId: session.id, collLoader: loader, autorun: false },
    ) as unknown as Engine;
    engine.onLimit = () => {
      void crawler
        .command("pause")
        .then(() => controller.command("pause"))
        .catch(() => {});
    };
    engine.beginVisual(
      session,
      new CoverageLedger(session.id, previous || undefined),
    );
    RECORDERS[session.tabId] = engine;
    await engine.persistCoverage();
    await engine.attach();
    if (!engine.running) throw new Error("Recorder did not connect.");
    engine.visual?.changed();
  },
  detach: async (session) => {
    const engine = RECORDERS[session.tabId];
    if (engine) {
      await engine.finishRecording();
      delete RECORDERS[session.tabId];
      return coverageText(engine.coverage.snapshot());
    }
  },
});

const CRAWL_KEY = "pageTrailControlledCrawl";
let crawlEngine: Engine | null = null;
const crawler = createCrawler({
  load: async () =>
    ((await chrome.storage.local.get(CRAWL_KEY))[CRAWL_KEY] as CrawlState) ||
    null,
  save: async (state) => {
    await chrome.storage.local.set({ [CRAWL_KEY]: state });
  },
  visit: async (url, config, signal) => {
    const session = await controller.status();
    if (
      !session ||
      session.id !== config.sessionId ||
      session.state !== "RECORDING"
    )
      throw new Error("Resume the matching recording first.");
    crawlEngine = RECORDERS[session.tabId];
    if (!crawlEngine) throw new Error("Recorder disconnected.");
    return crawlEngine.crawler.visit(url, config, signal);
  },
  release: async () => {
    await crawlEngine?.crawler.release();
    crawlEngine = null;
  },
});
let controlQueue: Promise<unknown> = Promise.resolve();

async function status() {
  const session = await controller.status();
  const engine = session && RECORDERS[session.tabId];
  const all = await loader.listAll();
  const archives = await Promise.all(
    all
      .filter((item) => item.type === "archive")
      .map(async (item) => ({
        id: item.name,
        title: item.config.metadata?.title || "Untitled archive",
        bytes: item.config.metadata?.size || 0,
        created: item.config.ctime,
        visual: await visualMeta(item.name),
        coverage:
          RECORDERS[session?.tabId || -1]?.visualSession?.id === item.name
            ? RECORDERS[session!.tabId].coverage.snapshot()
            : (await readCoverage(item.name))?.summary,
      })),
  );
  archives.sort((a, b) => (b.created || 0) - (a.created || 0));
  return {
    session,
    archives,
    stats: engine?.getStatusMsg() || null,
    crawl: await crawler.status(),
  };
}

chrome.runtime.onMessage.addListener(
  (
    message: {
      method?: string;
      action?: string;
      tabId?: number;
      acknowledged?: boolean;
      pathPrefix?: string;
      crawlPath?: string;
      maxPages?: number;
      maxDepth?: number;
      crawlAcknowledged?: boolean;
    },
    sender: { id?: string; url?: string },
    respond: (value: unknown) => void,
  ) => {
    if (message.method !== "pagetrail.replay") return false;
    // Only our own top-level controls can operate recording. No content-script entry point.
    const allowed = ["popup.html", "dashboard.html"].map((path) =>
      chrome.runtime.getURL(path),
    );
    if (
      sender.id !== chrome.runtime.id ||
      !allowed.some(
        (url) => sender.url === url || sender.url?.startsWith(url + "?"),
      )
    ) {
      respond({ error: "Untrusted recording control." });
      return false;
    }
    void (async () => {
      if (message.action === "session-status")
        return { session: await controller.status() };
      const began = performance.now();
      if (message.action && message.action !== "status") {
        const work = controlQueue.then(async () => {
          const action = message.action!;
          if (action.startsWith("crawl-")) {
            const operation = action.slice(6);
            if (operation === "pause" || operation === "stop")
              return crawler.command(operation);
            if (operation !== "start" && operation !== "resume")
              throw new Error("Unknown crawl action.");
            const session = await controller.status();
            if (!session || session.state !== "RECORDING")
              throw new Error("Start or resume recording before crawling.");
            if (operation === "resume") {
              const prior = await crawler.status();
              if (prior?.config.sessionId !== session.id)
                throw new Error("This crawl belongs to a different recording.");
              return crawler.command("resume");
            }
            if (!message.crawlAcknowledged)
              throw new Error("Confirm the crawl boundary before starting.");
            if (!message.crawlPath?.trim())
              throw new Error("Choose an explicit crawl path.");
            const path = scopePath(message.crawlPath) || "/";
            if (
              !inScope(
                session.origin,
                session.origin + path,
                session.pathPrefix,
              )
            )
              throw new Error(
                "The crawl path must stay inside the recording boundary.",
              );
            const tab = await chrome.tabs.get(session.tabId);
            return crawler.command("start", {
              sessionId: session.id,
              origin: session.origin,
              path,
              seed: tab.url || "",
              maxPages: Number(message.maxPages),
              maxDepth: Number(message.maxDepth),
            });
          }
          if (["pause", "finish", "start"].includes(action))
            await crawler.command(action === "pause" ? "pause" : "stop");
          return controller.command(action, message);
        });
        controlQueue = work.catch(() => {});
        await work;
      }
      if (message.action && message.action !== "status")
        void recordDiagnostic("control", "RECORDER_ACTION_FINISHED", {
          outcome: "success",
          elapsedMs: performance.now() - began,
        });
      return await status();
    })()
      .then(respond)
      .catch((error) => {
        void recordDiagnostic("control", "RECORDER_ACTION_FAILED", {
          outcome: "failure",
          errorCode: safeErrorCode(error),
        });
        respond({
          error:
            error instanceof Error ? error.message : "Recorder action failed.",
        });
      });
    return true;
  },
);
chrome.tabs.onUpdated.addListener((id: number, change: { url?: string }) => {
  if (change.url)
    void (async () => {
      const session = await controller.status();
      if (
        session?.tabId === id &&
        !inScope(session.origin, change.url!, session.pathPrefix)
      )
        await crawler.command("pause");
      await controller.navigated(id, change.url!);
    })().catch(console.error);
});
chrome.tabs.onRemoved.addListener((id: number) => {
  void interrupt(id);
});
chrome.debugger.onDetach.addListener((tab: { tabId: number }) => {
  void interrupt(tab.tabId);
});
async function interrupt(id: number) {
  try {
    if ((await controller.status())?.tabId === id)
      await crawler.command("pause");
    await controller.interrupted(id);
  } catch (error) {
    console.error(error);
  }
}
chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: "#21624c" });
});

// Retain the upstream archive API, IndexedDB storage and replay service worker.
if (self.importScripts) self.importScripts("sw.js");
