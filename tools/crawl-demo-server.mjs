// SPDX-License-Identifier: AGPL-3.0-or-later
// Invented local content only; never proxies or fetches another site.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
let sourceEnabled = true;
const paths = new Set(["/sample", "/sample/tools", "/sample/reference"]);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4180");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (url.pathname === "/disable-sample" && req.method === "POST") {
      sourceEnabled = false;
      res.end("Sample source disabled; reader remains independent.");
      return;
    }
    if (url.pathname.startsWith("/sample") && !sourceEnabled) {
      res.writeHead(503).end("Sample source stopped");
      return;
    }
    if (paths.has(url.pathname)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const title =
        url.pathname === "/sample"
          ? "Sample learning library"
          : url.pathname.endsWith("tools")
            ? "Tools: inspect before use"
            : "Reference: label both ends";
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/sample/style.css"></head><body><main><img src="/sample/logo.svg" alt="Sample library"><nav><a href="/sample">Home</a><a href="/sample/tools">Tools</a><a href="/sample/reference">Reference</a></nav><h1>${title}</h1><p>CRAWLED-SAMPLE-CHECK · Only invented learning content.</p><p>Inspect tools before use. Confirm cable labels at both ends.</p><details><summary>Quick revision</summary><p>Purpose → procedure → checks. café · हिन्दी · 日本語</p></details><p><a href="/sample/tools#tip">Duplicate tools link</a> · <a href="/outside">Outside scope</a> · <a href="/sample/logout">Account action</a> · <a href="https://not-visited.example/">Other domain</a></p></main></body></html>`,
      );
    } else if (url.pathname === "/sample/style.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(
        "body{font:18px system-ui;background:#edf4ef;color:#193e31;margin:0}main{max-width:850px;margin:60px auto;padding:30px}nav{display:flex;gap:24px;margin:20px 0}a{color:#27634b}img{width:60px}details{padding:24px;background:white;border-radius:12px}",
      );
    } else if (url.pathname === "/sample/logo.svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" rx="12" fill="#27634b"/><text x="15" y="42" font-size="36" fill="white">P</text></svg>',
      );
    } else if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PageTrail · Controlled crawling test</title><link rel="stylesheet" href="/pagetrail.css"><script defer src="/crawl-demo.js"></script></head><body><main><small>PHASE 4 · LOCAL SAMPLE</small><h1>Controlled crawling</h1><p>Production crawl queue and archive exporter; this test uses HTTP page downloads instead of the Edge debugger. No private website data.</p><section class="card"><h2>Boundary: /sample · this exact site</h2><p>20-page limit · depth 2 · duplicate and excluded links included in the sample.</p><div class="buttons"><button id="start">Start sample crawl</button><button id="pause" disabled>Pause crawl</button><button id="resume" disabled>Resume crawl</button><button id="stop" disabled>Stop crawl</button><button id="export" disabled>Export sample WACZ</button></div><p id="crawl-status" role="status">Ready</p><ol id="crawl-pages"></ol><p id="export-result"></p></section></main></body></html>',
      );
    } else if (
      url.pathname === "/pagetrail.css" ||
      /^\/[a-zA-Z0-9_.-]+\.js$/.test(url.pathname)
    ) {
      res.setHeader(
        "Content-Type",
        url.pathname.endsWith(".css") ? "text/css" : "text/javascript",
      );
      res.end(
        await readFile(
          url.pathname.endsWith(".css")
            ? "static/pagetrail.css"
            : "dist/test-export" + url.pathname,
        ),
      );
    } else res.writeHead(404).end("No sample route");
  } catch {
    res.writeHead(500).end("Sample asset unavailable");
  }
});
server.listen(4180, "127.0.0.1", () =>
  console.log("Controlled crawl sample: http://127.0.0.1:4180"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
