// SPDX-License-Identifier: AGPL-3.0-or-later
// TEST ONLY: real recorder adapter/DB/exporter, simulated debugger events/bodies.
import { CollectionLoader } from "@webrecorder/wabac/swlib";
import { LocalRecorder } from "./capture-recorder";
import { CoverageLedger, RESOURCE_LIMIT } from "./coverage";
import { readCoverage } from "./coverage-store";
import { createLocalExport } from "./export";
import { readVisualArchive } from "./visual-store";
import { fixtureCapture } from "./visual-fixture";
import type { Session } from "./session";
import { mountDashboard, type LibraryStatus } from "./dashboard-app";

// These no-op listener removals exist only inside this synthetic test document.
// No real extension installation, tabs, debugger or browser storage is controlled.
(globalThis as TODOFixMe).chrome = {
  debugger: {
    onDetach: { removeListener() {} },
    onEvent: { removeListener() {} },
  },
};
class FixtureRecorder extends LocalRecorder {
  pageUrl = "https://fixture.example/player";
  step = 1;
  bodyReads = 0;
  bodyDelay = 20;
  readonly missingBodies = new Set<string>();
  failStorage = false;
  closed = false;
  protected override finishTimings = { timeoutMs: 3000, quietMs: 80 };
  protected override currentTab() {
    return Promise.resolve({
      url: this.pageUrl,
      title: "Synthetic fixture",
    } as never);
  }
  override doUpdateStatus() {}
  override getFullText() {
    return Promise.resolve(null);
  }
  override async saveDetectedContentType() {}
  override _doDetach() {
    (this as TODOFixMe).isAttached = false;
    return Promise.resolve();
  }
  override _doStop() {
    super._doStop();
    this.closed = true;
  }
  override async send(
    method: string,
    params: Record<string, unknown> | null = null,
  ): Promise<TODOFixMe> {
    if (method === "Page.captureSnapshot")
      return { data: fixtureCapture(this.step) };
    if (method === "Network.getResponseBody") {
      if (this.missingBodies.has(String(params?.requestId)))
        throw new Error("Simulated unavailable cache body");
      const sequence = ++this.bodyReads;
      await new Promise((done) => setTimeout(done, this.bodyDelay));
      return { body: "Recorded response " + sequence, base64Encoded: false };
    }
    return {};
  }
  override async _doAddResource(
    data: Parameters<LocalRecorder["_doAddResource"]>[0],
  ) {
    if (this.failStorage) throw new Error("Simulated disk failure");
    // Force a timestamp collision so preservation is not dependent on test speed.
    data.ts = 1700000000000;
    return super._doAddResource(data);
  }
  useShortDeadline() {
    this.finishTimings = { timeoutMs: 100, quietMs: 5 };
  }
}
const button = document.getElementById(
  "run-capture-tests",
) as HTMLButtonElement;
const results = document.getElementById("capture-results")!;
const note = document.getElementById("capture-test-status")!;
const archives: LibraryStatus["archives"] = [];
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function pass(message: string) {
  const line = document.createElement("li");
  line.textContent = "PASS · " + message;
  results.append(line);
}
async function setup() {
  const loader = new CollectionLoader();
  const coll = await loader.initNewColl({
    title: "Phase 2 · synthetic capture fixture",
  });
  const engine = new FixtureRecorder(
    { tabId: 9001 },
    {
      collId: coll.name,
      collLoader: {
        loadColl: () => Promise.resolve(coll),
        updateSize: async () => {},
      },
    },
  );
  Object.assign(engine, {
    db: coll.store,
    running: true,
    isAttached: true,
    pageInfo: {
      id: "fixture-page",
      url: "https://fixture.example/player",
      title: "Invented lesson",
      ts: Date.now(),
      size: 0,
    },
  });
  const session: Session = {
    id: coll.name,
    tabId: 9001,
    origin: "https://fixture.example",
    pathPrefix: "/player",
    title: "Synthetic fixture",
    startedAt: new Date().toISOString(),
    state: "RECORDING",
    notice: "",
  };
  engine.beginVisual(session, new CoverageLedger(coll.name));
  await engine.persistCoverage();
  return { engine, loader, coll, session };
}
async function start(
  engine: FixtureRecorder,
  id: string,
  url: string,
  status = 200,
  length = 50,
) {
  await engine.processMessage(
    "Network.requestWillBeSent",
    {
      requestId: id,
      request: { url, method: "GET", headers: {} },
      type: "Fetch",
    },
    [],
  );
  await engine.processMessage(
    "Network.responseReceived",
    {
      requestId: id,
      response: {
        url,
        status,
        statusText: "Fixture",
        protocol: "h2",
        headers: {
          "content-type": "application/json",
          "content-length": String(length),
        },
      },
    },
    [],
  );
}
async function complete(engine: FixtureRecorder, id: string) {
  await engine.processMessage(
    "Network.loadingFinished",
    { requestId: id, encodedDataLength: 50 },
    [],
  );
}
button.onclick = () => {
  button.disabled = true;
  note.textContent =
    "Running real recorder/IndexedDB logic with simulated debugger events…";
  void (async () => {
    const t = await setup();
    await start(
      t.engine,
      "same-1",
      "https://content.other.example/lesson?unit=1",
    );
    const first = complete(t.engine, "same-1");
    await start(
      t.engine,
      "same-2",
      "https://content.other.example/lesson?unit=1",
    );
    const second = complete(t.engine, "same-2");
    await Promise.all([first, second]);
    await t.engine.captureWork.idle();
    const records = await t.coll.store.db.getAll("resources");
    assert(
      records.filter((r: TODOFixMe) => r.url.includes("/lesson?unit=1"))
        .length === 2,
      "same-URL responses were overwritten",
    );
    const repeated = records.filter((r: TODOFixMe) =>
      r.url.includes("/lesson?unit=1"),
    );
    assert(
      new Set(repeated.map((r: TODOFixMe) => r.ts)).size === 2,
      "timestamp collision was not separated",
    );
    assert(
      new Set(
        repeated.map((r: TODOFixMe) => new TextDecoder().decode(r.payload)),
      ).size === 2,
      "distinct bodies were lost",
    );
    pass(
      "Distinct same-URL responses and cross-host lesson assets remain in the native archive.",
    );
    await start(t.engine, "aborted", "https://fixture.example/unfinished");
    await t.engine.processMessage(
      "Network.loadingFailed",
      { requestId: "aborted", type: "Fetch", errorText: "net::ERR_ABORTED" },
      [],
    );
    await start(t.engine, "missing", "https://fixture.example/missing", 404);
    await complete(t.engine, "missing");
    await start(t.engine, "cached", "https://fixture.example/cached");
    t.engine.missingBodies.add("cached");
    await t.engine.processMessage(
      "Network.requestServedFromCache",
      { requestId: "cached" },
      [],
    );
    await complete(t.engine, "cached");
    await start(
      t.engine,
      "cached-ok",
      "https://fixture.example/cached-available",
    );
    await t.engine.processMessage(
      "Network.requestServedFromCache",
      { requestId: "cached-ok" },
      [],
    );
    await complete(t.engine, "cached-ok");
    await start(t.engine, "empty", "https://fixture.example/empty", 204, 0);
    await t.engine.processMessage(
      "Network.loadingFinished",
      { requestId: "empty", encodedDataLength: 0 },
      [],
    );
    await t.engine.captureWork.idle();
    assert(
      t.engine.coverage.snapshot().counts.failed === 2,
      "network/HTTP failures not classified",
    );
    assert(
      t.engine.coverage.snapshot().counts.unavailable === 1,
      "cached body gap not visible",
    );
    pass(
      "Aborted, HTTP-error, cached-body and valid empty-response outcomes are classified.",
    );
    await t.engine.visual!.stop(true);
    t.engine.step = 2;
    await start(t.engine, "slow", "https://fixture.example/slow");
    t.engine.bodyDelay = 100;
    const slow = complete(t.engine, "slow");
    await t.engine.finishRecording();
    await slow;
    assert(
      t.engine.closed && t.engine.captureWork.size === 0,
      "closed before body/commit settled",
    );
    const coverage = await readCoverage(t.session.id, true);
    assert(
      coverage?.summary.settled && coverage.summary.counts.pending === 0,
      "coverage not durably finalised",
    );
    assert(
      coverage.summary.counts.saved === 5 &&
        coverage.summary.counts.failed === 2,
      "incorrect final counts",
    );
    pass(
      "Finish waits for slow body reads and archive writes, then persists final coverage.",
    );
    const visual = await readVisualArchive(t.session.id);
    assert(
      visual.states.length === 2,
      "distinct same-URL visual states were merged",
    );
    pass("Both same-URL visual states survive in the separate visual store.");
    for (const format of ["html", "md", "reading", "coverage"] as const) {
      const file = await createLocalExport(t.session.id, format);
      const text = await file.blob.text();
      assert(
        text.includes("observed requests only"),
        "coverage warning absent from " + format,
      );
      if (format !== "coverage")
        assert(
          text.includes("Inspect before use") &&
            text.includes("Label both ends"),
          "lesson content absent from " + format,
        );
      if (format === "coverage") {
        const report = JSON.parse(text);
        assert(report.entries.length === 8, "report request count mismatch");
        assert(
          !text.includes("unit=1"),
          "query string leaked into coverage report",
        );
      }
    }
    pass(
      "Production HTML, Markdown, reading HTML and coverage JSON retain content and coverage warnings.",
    );
    const replay = await createLocalExport(t.session.id, "wacz");
    assert(
      (await replay.blob.text()).includes("PageTrail capture coverage:"),
      "coverage summary absent from one-file WACZ manifest",
    );
    pass(
      "The one-file WACZ archive includes its capture summary in exported metadata.",
    );
    archives.push({
      id: t.session.id,
      title: "Phase 2 · completed synthetic capture",
      bytes: coverage.summary.bytes,
      visual: visual.meta,
      coverage: coverage.summary,
    });

    const limit = await setup();
    await start(
      limit.engine,
      "large",
      "https://fixture.example/large",
      200,
      RESOURCE_LIMIT + 1,
    );
    await complete(limit.engine, "large");
    await limit.engine.captureWork.idle();
    assert(
      limit.engine.bodyReads === 0 &&
        limit.engine.coverage.snapshot().counts.unsupported === 1,
      "declared oversized body was read",
    );
    limit.engine.doAsyncFetch({ url: "https://fixture.example/extra" }, []);
    assert(
      limit.engine.coverage.snapshot().counts.excluded === 1,
      "supplementary fetch was not excluded",
    );
    await limit.engine.finishRecording();
    pass(
      "Declared oversized responses are skipped before body reads; supplementary fetching is disabled.",
    );

    const failed = await setup();
    failed.engine.failStorage = true;
    await start(failed.engine, "disk", "https://fixture.example/disk");
    await complete(failed.engine, "disk");
    await failed.engine.captureWork.idle();
    assert(
      failed.engine.coverage.snapshot().counts.failed === 1,
      "storage failure counted saved",
    );
    failed.engine.failStorage = false;
    await failed.engine.finishRecording();
    pass("A simulated storage failure is recorded as failed, not saved.");

    const silent = await setup();
    const originalAdd = silent.coll.store.addResource.bind(silent.coll.store);
    silent.coll.store.addResource = () => Promise.resolve(false);
    await start(
      silent.engine,
      "silent",
      "https://fixture.example/silent-storage",
    );
    await complete(silent.engine, "silent");
    await silent.engine.captureWork.idle();
    assert(
      silent.engine.coverage.snapshot().counts.failed === 1,
      "silently missing native write was counted saved",
    );
    silent.coll.store.addResource = originalAdd;
    await silent.engine.finishRecording();
    pass(
      "An unconfirmed native DB write is detected even when its API reports a dedup-like result.",
    );

    const scope = await setup();
    await start(
      scope.engine,
      "boundary",
      "https://fixture.example/old-page-asset",
    );
    scope.engine.pageUrl = "https://child.fixture.example/player";
    await complete(scope.engine, "boundary");
    await scope.engine.captureWork.idle();
    assert(
      scope.engine.coverage.snapshot().counts.excluded === 1,
      "nested top-level origin was stored",
    );
    await scope.engine.finishRecording();
    pass(
      "Leaving the exact top-level origin rejects subsequent archive writes.",
    );

    const hung = await setup();
    hung.engine.useShortDeadline();
    let release!: () => void;
    hung.engine.captureWork.track(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    let timedOut = false;
    try {
      await hung.engine.finishRecording();
    } catch {
      timedOut = true;
    }
    assert(
      timedOut && !hung.engine.coverage.snapshot().settled,
      "hung finish falsely confirmed success",
    );
    release();
    await hung.engine.captureWork.idle();
    await hung.engine.finishRecording();
    assert(
      hung.engine.coverage.snapshot().settled,
      "finish retry did not recover",
    );
    pass(
      "A stalled commit times out without false success; Finish can recover after it settles.",
    );

    mountDashboard({
      status: () => Promise.resolve({ session: null, archives }),
    });
    note.textContent =
      "PASS · 11 browser integration checks. Real local adapter/DB/exporter; debugger events and payloads are simulated. No real Edge recording or private content was used.";
    for (const item of [t, limit, failed, silent, scope, hung])
      item.loader.colldb?.close();
  })()
    .catch((error) => {
      note.textContent =
        "FAIL · " +
        (error instanceof Error ? error.message : "Capture fixture failed");
    })
    .finally(() => {
      button.disabled = false;
    });
};
