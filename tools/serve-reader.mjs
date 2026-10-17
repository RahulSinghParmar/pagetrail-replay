// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep, extname } from "node:path";
const root = dirname(fileURLToPath(import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1:4175").pathname,
    );
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (
      !file.startsWith(root + sep) ||
      ![".html", ".js", ".css", ".wasm"].includes(extname(file))
    ) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[extname(file)],
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("Not found.");
  }
});
server.on("error", (error) => {
  console.error("Could not start the local reader:", error.message);
  process.exitCode = 1;
});
server.listen(4175, "127.0.0.1", () =>
  console.log(
    "Open http://127.0.0.1:4175/ and choose your local WACZ file. Ctrl+C stops this reader. Files stay on your computer.",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
