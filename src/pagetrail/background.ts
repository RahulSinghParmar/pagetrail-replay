// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import { CollectionLoader } from "@webrecorder/wabac/swlib";
import { BrowserRecorder } from "../ext/browser-recorder";
import { createSessionController, inScope } from "./session";
import { cleanHeaders, sensitiveEndpoint } from "./privacy";
import { saveCapture, visualMeta, visualError } from "./visual-store";
import {
  captureLoop,
  OBSERVER_BINDING,
  OBSERVER_SOURCE,
  OBSERVER_WORLD,
} from "./visual-capture";
import type { Session } from "./session";

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
type Resource = {
  url: string;
  reqHeaders?: Record<string, string> | null;
  respHeaders?: Record<string, string> | null;
  payload: Uint8Array;
};
const loader = new CollectionLoader();
const RECORDERS: Record<string, Engine> = {};
self.recorders = RECORDERS;
const KEY = "pageTrailReplaySession";
let captureOrigin = "";

class LocalRecorder extends BrowserRecorder {
  visual: ReturnType<typeof captureLoop> | null = null;
  visualSession: Session | null = null;
  observerScripts: { id: string; sessions: never[] }[] = [];
  observerContexts: { id: number; sessions: never[] }[] = [];
  beginVisual(session: Session) {
    this.visualSession = session;
    this.visual = captureLoop({
      capture: async (action) => {
        const before = await chrome.tabs.get(session.tabId);
        if (
          !inScope(session.origin, before.url || "") ||
          sensitiveEndpoint(before.url || "")
        )
          return;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const snapshot = await Promise.race([
          this.send("Page.captureSnapshot", {
            format: "mhtml",
          } as never) as Promise<{ data?: string }>,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    "Visual capture timed out. Saved resources remain available; check coverage before export.",
                  ),
                ),
              15000,
            );
          }),
        ]).finally(() => clearTimeout(timeout));
        const after = await chrome.tabs.get(session.tabId);
        if (
          after.url !== before.url ||
          !inScope(session.origin, after.url || "")
        )
          return;
        if (!snapshot?.data)
          throw new Error("Browser did not return a visual page capture.");
        const meta = await visualMeta(session.id);
        await saveCapture(
          session.id,
          snapshot.data,
          { url: before.url!, title: before.title || session.title },
          action && meta.states
            ? { ...action, from: meta.states - 1 }
            : undefined,
        );
      },
      error: async (error) => {
        await visualError(
          session.id,
          error instanceof Error ? error.message : String(error),
        );
      },
    });
  }
  override async sessionInit(sessions: never[]) {
    await super.sessionInit(sessions);
    if (!this.visual) return;
    try {
      await this.send("Runtime.enable", null, sessions);
      await this.send(
        "Runtime.addBinding",
        {
          name: OBSERVER_BINDING,
          executionContextName: OBSERVER_WORLD,
        } as never,
        sessions,
      );
      const script = (await this.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source: OBSERVER_SOURCE,
          worldName: OBSERVER_WORLD,
          runImmediately: true,
        } as never,
        sessions,
      )) as { identifier: string };
      this.observerScripts.push({
        id: script.identifier,
        sessions: [...sessions],
      });
    } catch {
      // Non-document targets (workers) do not expose Page. Top-level capture is checked at Finish.
    }
  }
  override async processMessage(
    method: string,
    params: Record<string, unknown>,
    sessions: never[],
  ) {
    if (method === "Runtime.executionContextDestroyed")
      this.observerContexts = this.observerContexts.filter(
        (context) =>
          !(
            context.id === params.executionContextId &&
            context.sessions.join() === sessions.join()
          ),
      );
    if (method === "Runtime.executionContextsCleared")
      this.observerContexts = this.observerContexts.filter(
        (context) => context.sessions.join() !== sessions.join(),
      );
    if (method === "Runtime.executionContextCreated") {
      const context = params.context as { id: number; name: string };
      if (context.name === OBSERVER_WORLD)
        this.observerContexts.push({ id: context.id, sessions: [...sessions] });
    }
    if (
      method === "Runtime.bindingCalled" &&
      params.name === OBSERVER_BINDING &&
      this.observerContexts.some(
        (context) =>
          context.id === params.executionContextId &&
          context.sessions.join() === sessions.join(),
      )
    ) {
      try {
        const data = JSON.parse(String(params.payload).slice(0, 4000));
        const action =
          typeof data.frame === "string" && typeof data.selector === "string"
            ? {
                frame: data.frame.slice(0, 2000),
                selector: data.selector.slice(0, 1500),
                label: String(data.label || "").slice(0, 120),
              }
            : undefined;
        this.visual?.changed(action);
      } catch {
        /* Malformed page notification has no recording authority. */
      }
      return;
    }
    if (
      [
        "Page.loadEventFired",
        "Page.frameStoppedLoading",
        "Page.navigatedWithinDocument",
      ].includes(method)
    )
      this.visual?.changed();
    return super.processMessage(method, params, sessions);
  }
  async endVisual(final: boolean) {
    await this.visual?.stop(final);
    this.visual = null;
    for (const context of this.observerContexts)
      await this.send(
        "Runtime.evaluate",
        {
          expression: "globalThis.__ptVisualStop?.()",
          contextId: context.id,
        } as never,
        context.sessions,
      ).catch(() => {});
    for (const script of this.observerScripts) {
      await this.send(
        "Page.removeScriptToEvaluateOnNewDocument",
        { identifier: script.id } as never,
        script.sessions,
      ).catch(() => {});
      await this.send(
        "Runtime.removeBinding",
        { name: OBSERVER_BINDING } as never,
        script.sessions,
      ).catch(() => {});
    }
    this.observerContexts = [];
    this.observerScripts = [];
  }
  override _doStop() {
    // Unexpected disconnect: cancel future jobs without trying to use a detached debugger.
    void this.visual?.stop(false).catch(console.warn);
    this.visual = null;
    super._doStop();
  }
  override async _doAddResource(data: Resource) {
    // Filter before storage, not only at export. Body/query secrets still require review.
    if (sensitiveEndpoint(data.url)) return 0;
    let status;
    try {
      status = await chrome.tabs.get(
        (this as unknown as { tabId: number }).tabId,
      );
    } catch {
      return 0;
    }
    if (!inScope(captureOrigin, status.url || "")) return 0;
    return super._doAddResource({
      ...data,
      reqHeaders: cleanHeaders(data.reqHeaders),
      respHeaders: cleanHeaders(data.respHeaders),
    });
  }
}

const controller = createSessionController({
  load: async () => (await chrome.storage.local.get(KEY))[KEY] || null,
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
    captureOrigin = session.origin;
    await chrome.storage.local.set({
      archiveCookies: "0",
      archiveStorage: "0",
      archiveScreenshots: "0",
      archiveFlash: "0",
      autorunBehaviors: "0",
    });
    const engine = new LocalRecorder(
      { tabId: session.tabId },
      { collId: session.id, collLoader: loader, autorun: false },
    ) as unknown as Engine;
    engine.beginVisual(session);
    RECORDERS[session.tabId] = engine;
    await engine.attach();
    if (!engine.running) throw new Error("Recorder did not connect.");
    engine.visual?.changed();
  },
  detach: async (session) => {
    const engine = RECORDERS[session.tabId];
    if (engine) {
      await engine.endVisual(Boolean(engine.running && engine.isAttached));
      if (engine.pageTrailStop) await engine.pageTrailStop;
      if (engine.running) await engine.detach();
      else {
        if (engine.isAttached) await engine._doDetach();
        engine._doStop();
      }
      delete RECORDERS[session.tabId];
    }
  },
});

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
      })),
  );
  archives.sort((a, b) => (b.created || 0) - (a.created || 0));
  return { session, archives, stats: engine?.getStatusMsg() || null };
}

chrome.runtime.onMessage.addListener(
  (
    message: {
      method?: string;
      action?: string;
      tabId?: number;
      acknowledged?: boolean;
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
      if (message.action && message.action !== "status")
        await controller.command(message.action, message);
      return await status();
    })()
      .then(respond)
      .catch((error) =>
        respond({
          error:
            error instanceof Error ? error.message : "Recorder action failed.",
        }),
      );
    return true;
  },
);
chrome.tabs.onUpdated.addListener((id: number, change: { url?: string }) => {
  if (change.url)
    void controller.navigated(id, change.url).catch(console.error);
});
chrome.tabs.onRemoved.addListener((id: number) => {
  void controller.interrupted(id).catch(console.error);
});
chrome.debugger.onDetach.addListener((tab: { tabId: number }) => {
  void controller.interrupted(tab.tabId).catch(console.error);
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: "#21624c" });
});

// Retain the upstream archive API, IndexedDB storage and replay service worker.
if (self.importScripts) self.importScripts("sw.js");
