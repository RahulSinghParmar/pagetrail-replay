// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic test server; serves no user recordings or arbitrary filesystem paths.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://127.0.0.1:4178").pathname;
  try {
    res.setHeader("Cache-Control", "no-store");
    if (path === "/") {
      const html = await readFile("static/dashboard.html", "utf8");
      const controls =
        '<section class="card"><h2>Phase 2 · synthetic capture integration</h2><p>No actual browser debugger is used. Events and payloads are simulated; the recorder adapter, archive database, coverage storage and exporters are production code.</p><button id="run-capture-tests">Run capture integration checks</button><p id="capture-test-status" role="status">Ready</p><ol id="capture-results"></ol></section>';
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.end(
        html
          .replace('src="dashboard.js"', 'src="/capture-demo.js"')
          .replace(
            '<section id="archives"',
            controls + '<section id="archives"',
          ),
      );
    } else if (
      path === "/pagetrail.css" ||
      /^\/[a-zA-Z0-9_.-]+\.js$/.test(path)
    ) {
      res.setHeader(
        "Content-Type",
        path.endsWith(".css") ? "text/css" : "text/javascript",
      );
      res.end(
        await readFile(
          path.endsWith(".css")
            ? "static/pagetrail.css"
            : "dist/test-export" + path,
        ),
      );
    } else res.writeHead(404).end();
  } catch {
    res.writeHead(404).end("Synthetic test asset unavailable.");
  }
});
server.listen(4178, "127.0.0.1", () =>
  console.log("Synthetic capture verification: http://127.0.0.1:4178"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
