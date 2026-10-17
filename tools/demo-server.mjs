// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const source = process.argv.includes("--source");
const root = resolve(source ? "test/fixtures/site" : "dist/reader");
const port = source ? 4176 : 4175;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".wacz": "application/zip",
  ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader("Cache-Control", "no-store");
    if (source && url.pathname === "/api/lesson") {
      const unit = url.searchParams.get("unit");
      const lesson =
        unit === "tools"
          ? {
              title: "Tools: inspect before use",
              body: "Check the condition of a tool before using it. This text was returned by a recorded API response.",
            }
          : {
              title: "Cables: identify and label",
              body: "Confirm both ends and keep an accurate label. This is a different API response selected by the site's original JavaScript.",
            };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(lesson));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (source && ["/", "/lesson", "/reference"].includes(pathname))
      pathname = "/index.html";
    if (source && pathname === "/embedded") pathname = "/embedded.html";
    if (!source && pathname === "/") pathname = "/index.html";
    const file =
      !source && pathname === "/demo.wacz"
        ? resolve("test/fixtures/interactive-demo.wacz")
        : resolve(root, "." + pathname);
    if (
      file !== resolve("test/fixtures/interactive-demo.wacz") &&
      !file.startsWith(root + sep)
    ) {
      res.writeHead(403).end();
      return;
    }
    const bytes = await readFile(file),
      info = await stat(file);
    res.setHeader(
      "Content-Type",
      mime[extname(file)] || "application/octet-stream",
    );
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Service-Worker-Allowed", "/");
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (range) {
      const start = Number(range[1]),
        end = range[2]
          ? Math.min(Number(range[2]), info.size - 1)
          : info.size - 1;
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Content-Length": end - start + 1,
      });
      res.end(bytes.subarray(start, end + 1));
    } else {
      res.writeHead(200, { "Content-Length": bytes.length });
      res.end(bytes);
    }
  } catch {
    res.writeHead(404).end("Not found in this local fixture server.");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(
    `${
      source ? "Original test site" : "Local replay reader"
    }: http://127.0.0.1:${port}`,
  );
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
