// SPDX-License-Identifier: AGPL-3.0-or-later
import { BrowserRecorder } from "../ext/browser-recorder";
import { CrawlDriver } from "./crawl-driver";
import { inScope } from "./scope";
import { cleanHeaders, sensitiveEndpoint } from "./privacy";
import { saveCapture, visualMeta, visualError } from "./visual-store";
import {
  captureLoop,
  OBSERVER_BINDING,
  OBSERVER_SOURCE,
  OBSERVER_WORLD,
} from "./visual-capture";
import type { Session } from "./session";
import { recordDiagnostic } from "./diagnostics";
import { bounded, OperationError, safeErrorCode } from "./operations";
import type { CoverageLedger, CoverageRequest } from "./coverage";
import { saveCoverage } from "./coverage-store";
import { waitForQuiet } from "./capture-work";
import type { IDBPDatabase } from "idb";

type Resource = {
  url: string;
  requestUrl?: string;
  status?: number;
  ts?: number;
  reqHeaders?: Record<string, string> | null;
  respHeaders?: Record<string, string> | null;
  payload: Uint8Array;
};

export class LocalRecorder extends BrowserRecorder {
  readonly crawler = new CrawlDriver({
    send: (method, params, sessions) =>
      this.send(method, params as never, sessions),
    pending: () =>
      this.coverage.snapshot().counts.pending + this.captureWork.size,
    capture: async () => {
      await this.visual?.flush();
    },
    persist: () => this.persistCoverage(true),
  });
  coverage!: CoverageLedger;
  onLimit?: () => void;
  protected finishTimings = { timeoutMs: 30000, quietMs: 10000 };
  protected currentTab() {
    return chrome.tabs.get(this.visualSession!.tabId);
  }
  private coverageTimer?: ReturnType<typeof setInterval>;
  private coverageWrite: Promise<void> | null = null;
  private finishWork: Promise<void> | null = null;
  private stoppingCapture = false;
  private writesAllowed = true;
  private limitPauseRequested = false;
  private visualStop: Promise<void> = Promise.resolve();
  private readonly resourceTimes = new Map<string, number>();
  visual: ReturnType<typeof captureLoop> | null = null;
  visualSession: Session | null = null;
  observerScripts: { id: string; sessions: never[] }[] = [];
  observerContexts: { id: number; sessions: never[] }[] = [];
  beginVisual(session: Session, coverage: CoverageLedger) {
    this.coverage = coverage;
    this.captureObserver = coverage;
    this.visualSession = session;
    this.coverageTimer = setInterval(() => {
      void this.persistCoverage().catch(() => {});
    }, 1000);
    this.visual = captureLoop({
      capture: async (action) => {
        const began = performance.now();
        const before = await this.currentTab();
        if (
          !this.writesAllowed ||
          !inScope(session.origin, before.url || "", session.pathPrefix) ||
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
        const after = await this.currentTab();
        if (
          after.url !== before.url ||
          !this.writesAllowed ||
          !inScope(session.origin, after.url || "", session.pathPrefix)
        ) {
          this.coverage.visualGap();
          return;
        }
        if (!snapshot?.data)
          throw new Error("Browser did not return a visual page capture.");
        const meta = await visualMeta(session.id);
        const saved = await saveCapture(
          session.id,
          snapshot.data,
          { url: before.url!, title: before.title || session.title },
          action && meta.states
            ? { ...action, from: meta.states - 1 }
            : undefined,
        );
        if (saved.states !== meta.states)
          void recordDiagnostic("capture", "STATE_SAVED", {
            states: saved.states,
            documents: saved.documents,
            bytes: saved.bytes,
            elapsedMs: performance.now() - began,
          });
      },
      error: async (error) => {
        this.coverage.visualGap();
        void recordDiagnostic("capture", "CAPTURE_FAILED", {
          errorCode: safeErrorCode(error),
        });
        await visualError(
          session.id,
          error instanceof Error ? error.message : String(error),
        );
      },
    });
  }
  persistCoverage(final = false): Promise<void> {
    if (this.coverageWrite)
      return final
        ? this.coverageWrite
            .catch(() => {})
            .then(() => this.persistCoverage(true))
        : this.coverageWrite;
    const work = (async () => {
      const batch = this.coverage.batch();
      try {
        await bounded(saveCoverage(batch), { ms: 5000 });
      } catch (error) {
        this.coverage.restoreDirty(batch.entries);
        this.coverage.persistenceFailure();
        throw error;
      }
    })().finally(() => {
      if (this.coverageWrite === work) this.coverageWrite = null;
    });
    this.coverageWrite = work;
    return work;
  }
  // Passive capture only in this phase. The upstream engine may otherwise fetch
  // extra links/media or retry a URL independently of the user's navigation.
  override doAsyncFetch(request: { url: string }, _sessions: never[]) {
    const skipped = { url: request.url, resourceType: "Supplementary" };
    this.coverage?.requested(skipped);
    this.coverage?.outcome(skipped, "excluded", "SUPPLEMENTARY_DISABLED");
  }
  override async fetchPayloads(
    params: Record<string, unknown>,
    request: CoverageRequest & {
      responseHeaders?: Record<string, string>;
      responseHeadersList?: { name: string; value: string }[];
    },
    sessions: never[],
    method: string,
  ) {
    const headers =
      request.responseHeadersList ||
      Object.entries(request.responseHeaders || {}).map(([name, value]) => ({
        name,
        value,
      }));
    const length = Number(
      headers.find((header) => header.name.toLowerCase() === "content-length")
        ?.value ||
        params.encodedDataLength ||
        0,
    );
    const reason = this.coverage.rejection(
      request,
      Number.isFinite(length) ? length : 0,
    );
    if (reason || !this.writesAllowed) {
      this.coverage.outcome(
        request,
        reason === "AUTH_ENDPOINT" ? "excluded" : "unsupported",
        reason || "FINISH_TIMEOUT",
      );
      if (reason === "SESSION_LIMIT" && !this.limitPauseRequested) {
        this.limitPauseRequested = true;
        this.onLimit?.();
      }
      return null;
    }
    return super.fetchPayloads(params, request, sessions, method);
  }
  async finishRecording() {
    this.stoppingCapture = true;
    this.coverage.finish(false);
    this.finishWork ||= (async () => {
      if (this.pageTrailStop) await this.pageTrailStop;
      else if ((this as unknown as { running: boolean }).running) {
        await waitForQuiet(
          () => this.coverage.snapshot().counts.pending + this.captureWork.size,
          { timeoutMs: this.finishTimings.quietMs },
        );
        await this.endVisual(
          Boolean((this as unknown as { isAttached: boolean }).isAttached),
        );
        await super.detach();
      } else {
        await this.endVisual(false);
        if ((this as unknown as { isAttached: boolean }).isAttached)
          await this._doDetach();
        await this.captureWork.idle();
        this._doStop();
      }
      await this.captureWork.idle();
      await this.visualStop;
    })().catch((error) => {
      this.finishWork = null;
      throw error;
    });
    try {
      await bounded(this.finishWork, {
        ms: this.finishTimings.timeoutMs,
        code: "FINISH_TIMEOUT",
        message: "Could not confirm capture stopped within 30 seconds.",
      });
      this.writesAllowed = false;
      this.coverage.unfinished("FINISH_TIMEOUT");
      this.coverage.finish(true);
      await this.persistCoverage(true);
    } catch (error) {
      this.writesAllowed = false;
      void this.visual?.stop(false).catch(() => {});
      this.coverage.unfinished("FINISH_TIMEOUT");
      this.coverage.finish(false);
      if ((this as unknown as { isAttached: boolean }).isAttached)
        await bounded(this._doDetach(), { ms: 2000 }).catch(() => {});
      await bounded(this.persistCoverage(true), { ms: 2000 }).catch(() => {});
      throw error;
    }
  }
  override async sessionInit(sessions: never[]) {
    await super.sessionInit(sessions);
    await this.crawler.target(sessions);
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
    if (method === "Target.detachedFromTarget")
      this.crawler.forget([...sessions, params.sessionId as never]);
    if (
      method === "Fetch.requestPaused" &&
      (await this.crawler.paused(params, sessions))
    )
      return;
    if (method === "Network.webSocketCreated") {
      const request = {
        url: String(params.url || ""),
        resourceType: "WebSocket",
      };
      this.coverage.requested(request);
    }
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
    const work = super.processMessage(method, params, sessions);
    return /^(Network|Fetch)\./.test(method)
      ? this.captureWork.track(work)
      : work;
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
    this.visualStop = this.visual?.stop(false) || Promise.resolve();
    void this.visualStop.catch(console.warn);
    this.visual = null;
    clearInterval(this.coverageTimer);
    if (this.coverage && !this.stoppingCapture) {
      this.writesAllowed = false;
      this.coverage.unfinished("INTERRUPTED");
      this.coverage.finish(false);
      void this.persistCoverage().catch(() => {});
    }
    super._doStop();
  }
  override _doAddPage(page: { url?: string }) {
    const session = this.visualSession;
    if (
      !this.writesAllowed ||
      !session ||
      sensitiveEndpoint(page.url || "") ||
      !inScope(session.origin, page.url || "", session.pathPrefix)
    )
      return Promise.resolve();
    return super._doAddPage(page);
  }
  override async _doAddResource(data: Resource) {
    // Filter before storage, not only at export. Body/query secrets still require review.
    const session = this.visualSession;
    let status;
    try {
      status = await this.currentTab();
    } catch {
      this.coverage.resourceOutcome(data, "unavailable", "INTERRUPTED");
      throw new OperationError(
        "CAPTURE_EXCLUDED",
        "The recording tab is unavailable.",
      );
    }
    if (
      !session ||
      !inScope(session.origin, status.url || "", session.pathPrefix)
    ) {
      this.coverage.resourceOutcome(data, "excluded", "OUT_OF_SCOPE");
      throw new OperationError(
        "CAPTURE_EXCLUDED",
        "Top-level page left the recording scope.",
      );
    }
    const bytes = data.payload?.byteLength || 0;
    // Recheck immediately before reservation: several writes can have awaited
    // tabs.get concurrently, so checking before that await would race the cap.
    const reason = !this.writesAllowed
      ? "FINISH_TIMEOUT"
      : this.coverage.rejection(
          { ...data, url: data.requestUrl || data.url },
          bytes,
        );
    if (reason) {
      this.coverage.resourceOutcome(
        data,
        reason === "AUTH_ENDPOINT" ? "excluded" : "unsupported",
        reason,
      );
      if (reason === "SESSION_LIMIT" && !this.limitPauseRequested) {
        this.limitPauseRequested = true;
        this.onLimit?.();
      }
      throw new OperationError(
        "CAPTURE_EXCLUDED",
        "Resource excluded by local capture policy.",
      );
    }
    this.coverage.reserve(bytes);
    // Retain object identity: native outcome callbacks are bound to this record.
    data.reqHeaders = cleanHeaders(data.reqHeaders);
    data.respHeaders = cleanHeaders(data.respHeaders);
    let saved = false;
    try {
      const archive = (
        this as unknown as { db: { initing: Promise<void>; db: IDBPDatabase } }
      ).db;
      await archive.initing;
      // Seed from the archive on first use, including after Resume. Recheck the
      // in-memory value after the cursor await to serialize concurrent timestamps.
      const latest = this.resourceTimes.has(data.url)
        ? null
        : await archive.db
            .transaction("resources", "readonly")
            .store.openCursor(
              IDBKeyRange.bound(
                [data.url],
                [data.url, Number.MAX_SAFE_INTEGER],
              ),
              "prev",
            );
      data.ts = Math.max(
        data.ts || Date.now(),
        (latest?.value.ts || 0) + 1,
        (this.resourceTimes.get(data.url) || 0) + 1,
      );
      this.resourceTimes.set(data.url, data.ts);
      const size = await super._doAddResource(data);
      // Upstream may swallow a transaction failure and return a dedup-like value.
      // Confirm the exact URL/time record exists before counting it as saved.
      const stored = await archive.db.get("resources", [data.url, data.ts]);
      if (size === undefined || !stored)
        throw new OperationError(
          "STORAGE_FAILED",
          "The resource could not be saved.",
        );
      saved = true;
      return size;
    } finally {
      this.coverage.release(bytes, saved);
    }
  }
}
