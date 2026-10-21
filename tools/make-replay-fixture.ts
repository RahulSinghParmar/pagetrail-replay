// SPDX-License-Identifier: AGPL-3.0-or-later
// Invented inputs, native WACZ exporter. Does not contact any website.
import { readFile, writeFile } from "node:fs/promises";
import { Downloader, type DBCollection } from "../src/sw/downloader.ts";
const base = "http://127.0.0.1:4176";
const ts = Date.UTC(2026, 9, 18, 0);
const html = await readFile("test/fixtures/replay-controls.html", "utf8");
const specs = [
  ["/controls", 200, "text/html", html, {}],
  [
    "/recorded404",
    404,
    "text/html",
    '<!doctype html><title>Captured 404</title><h1>RECORDED-404-CHECK: original server error retained</h1><a href="/controls">Return to controls</a>',
    {},
  ],
  ["/redirect", 302, "text/html", "", { location: base + "/controls" }],
  [
    "/api/value",
    200,
    "application/json",
    JSON.stringify({ message: "API-CHECK: saved response" }),
    {},
  ],
] as const;
const resources = specs
  .map(([path, status, mime, body, headers]) => {
    const payload = new TextEncoder().encode(body);
    return {
      url: base + path,
      ts,
      status,
      statusText:
        status === 404 ? "Not Found" : status === 302 ? "Found" : "OK",
      mime,
      payload,
      respHeaders: {
        "content-type": mime,
        "content-length": String(payload.length),
        ...headers,
      },
      reqHeaders: {},
      pageId: "controls",
    };
  })
  .sort((a, b) => a.url.localeCompare(b.url));
const pages = [
  {
    id: "controls",
    url: base + "/controls",
    ts,
    title: "Original controls",
    size: 0,
  },
];
class FixtureDownloader extends Downloader {
  override async loadResourcesBlock(start: [string, number] | [] = []) {
    return start.length ? [] : structuredClone(resources);
  }
}
const coll = {
  name: "phase3-synthetic-controls",
  config: {
    ctime: ts,
    decode: false,
    metadata: {
      title: "Phase 3 replay controls",
      desc: "Synthetic offline-only QA; no private content.",
    },
  },
  store: {
    getAllPages: async () => pages,
    loadPayload: async (r: { payload: Uint8Array }) => r.payload,
  },
} as unknown as DBCollection;
const response = await new FixtureDownloader({
  coll,
  format: "wacz",
  filename: "replay-controls",
  softwareString: "PageTrail synthetic QA",
}).download();
if (!(response instanceof Response)) throw new Error("Fixture export failed");
await writeFile(
  "test/fixtures/replay-controls.wacz",
  new Uint8Array(await response.arrayBuffer()),
);
console.log(
  "Created synthetic replay-controls.wacz (4 resources); no source website contacted.",
);
