// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const routes = {
  "/": ["test/fixtures/export-demo.html", "text/html;charset=utf-8"],
  "/export-demo.js": [
    "dist/test-export/export-demo.js",
    "text/javascript;charset=utf-8",
  ],
  "/reading.html": [
    "test/artifacts/reading-demo.html",
    "text/html;charset=utf-8",
  ],
  "/learning.html": [
    "test/artifacts/phase5-learning/index.html",
    "text/html;charset=utf-8",
  ],
  "/session.html": [
    "test/artifacts/visual-session-demo.html",
    "text/html;charset=utf-8",
  ],
  "/pagetrail.css": ["static/pagetrail.css", "text/css;charset=utf-8"],
  "/dashboard-test.html": ["static/dashboard.html", "text/html;charset=utf-8"],
};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1:4177").pathname;
  const route =
    routes[pathname] ||
    (/^\/[a-zA-Z0-9_.-]+\.js$/.test(pathname)
      ? ["dist/test-export" + pathname, "text/javascript;charset=utf-8"]
      : null);
  if (!route) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.writeHead(200, {
      "Content-Type": route[1],
      "Cache-Control": "no-store",
    });
    const bytes = await readFile(route[0]);
    res.end(
      pathname === "/dashboard-test.html"
        ? bytes
            .toString()
            .replace('src="dashboard.js"', 'src="/dashboard-demo.js"')
        : bytes,
    );
  } catch {
    res.end("Test artifact is not available yet.");
  }
});
server.listen(4177, "127.0.0.1", () =>
  console.log("Export verification: http://127.0.0.1:4177"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
