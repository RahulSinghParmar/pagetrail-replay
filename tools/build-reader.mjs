// SPDX-License-Identifier: AGPL-3.0-or-later
// Local staging only; never touches release packages or GitHub.
import { cp, mkdir } from "node:fs/promises";
await mkdir("dist/reader", { recursive: true });
await cp("static/offline-reader.html", "dist/reader/index.html");
for (const file of ["serve-reader.mjs", "start-reader.command"])
  await cp("tools/" + file, "dist/reader/" + file);
await cp("LICENSE.md", "dist/reader/LICENSE.md");
console.log("Local reader staged in dist/reader; no release created.");
