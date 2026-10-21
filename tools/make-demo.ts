// SPDX-License-Identifier: AGPL-3.0-or-later
// Test-only resource harvesting: not the extension's Chrome-debugger capture path.
import { writeFile } from "node:fs/promises";
import { Downloader, type DBCollection } from "../src/sw/downloader.ts";
const base = "http://127.0.0.1:4176";
const output =
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ||
  "test/fixtures/interactive-demo.wacz";
const paths = [
  "/",
  "/lesson?unit=tools",
  "/reference",
  "/app.js",
  "/style.css",
  "/logo.svg",
  "/embedded",
  "/api/lesson?unit=tools",
  "/api/lesson?unit=cables",
];
const ts = Date.now();
const resources = [];
for (const path of paths) {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error("Demo source is unavailable: " + path);
  const payload = new Uint8Array(await response.arrayBuffer());
  resources.push({
    url: base + path,
    ts,
    status: response.status,
    statusText: "OK",
    payload,
    mime: response.headers.get("content-type")!.split(";")[0],
    respHeaders: {
      "content-type": response.headers.get("content-type")!,
      "content-length": String(payload.length),
    },
    reqHeaders: {},
    pageId: "demo-home",
  });
}
resources.sort((a, b) => a.url.localeCompare(b.url));
const pages = paths.slice(0, 3).map((path, i) => ({
  id: "demo-" + i,
  url: base + path,
  ts,
  title: ["Learning Library", "Tools lesson", "Reference guide"][i],
  size: 0,
}));
const store = {
  getAllPages: async () => pages,
  loadPayload: async (resource: { payload: Uint8Array }) => resource.payload,
};
class DemoDownloader extends Downloader {
  override async loadResourcesBlock(start: [string, number] | [] = []) {
    return start.length ? [] : structuredClone(resources);
  }
}
const coll = {
  name: "synthetic-demo",
  config: {
    ctime: ts,
    decode: false,
    metadata: {
      title: "Interactive offline library",
      desc: "Synthetic content only; no employee data.",
    },
  },
  store,
} as unknown as DBCollection;
const response = await new DemoDownloader({
  coll,
  format: "wacz",
  filename: "interactive-demo",
  softwareString: "PageTrail Replay test / ArchiveWeb.page",
}).download();
if (!(response instanceof Response))
  throw new Error("Native WACZ exporter failed.");
const data = new Uint8Array(await response.arrayBuffer());
await writeFile(output, data);
console.log(
  JSON.stringify({
    file: output,
    bytes: data.length,
    resources: resources.length,
    pages: pages.length,
  }),
);
