// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  access,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, basename, dirname } from "node:path";
await mkdir("dist/reader", { recursive: true });
for (const file of ["ui.js", "sw.js", "reader-sw.js"])
  await cp("dist/ext/" + file, "dist/reader/" + file);
await cp("static/offline-reader.html", "dist/reader/index.html");
const manifest = JSON.parse(await readFile("dist/ext/manifest.json", "utf8"));
const release = JSON.parse(await readFile("pagetrail-release.json", "utf8"));
if (
  !/^\d+\.\d+\.\d+$/.test(release.version) ||
  release.channel !== "beta" ||
  !Number.isInteger(release.iteration) ||
  release.iteration < 1
)
  throw new Error("Invalid beta release metadata.");
const version = `${release.version}-${release.channel}.${release.iteration}`;
if (manifest.version !== release.version || manifest.manifest_version !== 3)
  throw new Error("Unexpected recorder manifest.");
for (const file of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  "dashboard.html",
  "popup.js",
  "dashboard.js",
  "sw.js",
  "LICENSE.md",
])
  await access("dist/ext/" + file);
const root = `release/PageTrail-Replay-${version}`;
await mkdir(root, { recursive: true });
await cp("dist/ext", root + "/extension", { recursive: true });
await cp("dist/reader", root + "/reader", { recursive: true });
for (const file of [
  "README.md",
  "PAGETRAIL.md",
  "UPSTREAM.md",
  "LICENSE.md",
  "pagetrail-release.json",
  "BETA-RELEASE.md",
  "BETA-ACCEPTANCE.md",
])
  await cp(file, root + "/" + file);
await cp("test/VERIFICATION.md", root + "/VERIFICATION.md");
await mkdir(root + "/licenses", { recursive: true });
await cp("node_modules/parse5/LICENSE", root + "/licenses/parse5-MIT.txt");
await mkdir(root + "/examples", { recursive: true });
for (const [source, destination] of [
  ["test/artifacts/visual-session-demo.html", "website-session-example.html"],
  ["test/artifacts/visual-session-demo.md", "website-session-text-example.md"],
  ["test/artifacts/visual-session-proof.jpg", "website-session-proof.jpg"],
  ["test/artifacts/reading-demo.html", "reading-example.html"],
  ["test/artifacts/reading-demo.md", "reading-example.md"],
  ["test/artifacts/reading-export-proof.jpg", "reading-export-proof.jpg"],
]) {
  try {
    await access(source);
  } catch {
    continue;
  }
  await cp(source, root + "/examples/" + destination);
}
// Browser-generated proof images are local, optional QA artifacts. A fresh checkout
// must build without them and must never sweep arbitrary recordings into a release.
try {
  await access("test/artifacts/offline-replay-proof.jpg");
  await cp(
    "test/artifacts/offline-replay-proof.jpg",
    root + "/offline-replay-proof.jpg",
  );
} catch {
  /* optional local QA artifact */
}
await cp("tools/serve-reader.mjs", root + "/reader/serve-reader.mjs");
await cp("tools/start-reader.command", root + "/reader/start-reader.command");
await cp(
  "test/fixtures/interactive-demo.wacz",
  root + "/interactive-demo.wacz",
);
async function hashes(dir, relative = "") {
  const items = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name),
      name = relative + entry.name;
    if (entry.isDirectory()) items.push(...(await hashes(path, name + "/")));
    else if (entry.name !== "SHA256SUMS")
      items.push(
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex") +
          "  " +
          name,
      );
  }
  return items;
}
await writeFile(root + "/SHA256SUMS", (await hashes(root)).join("\n") + "\n");
const result =
  process.platform === "darwin"
    ? spawnSync(
        "/usr/bin/ditto",
        ["-c", "-k", "--norsrc", "--keepParent", root, root + ".zip"],
        { stdio: "inherit" },
      )
    : spawnSync("zip", ["-q", "-r", basename(root) + ".zip", basename(root)], {
        cwd: dirname(root),
        stdio: "inherit",
      });
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error("ZIP packaging failed: " + result.status);
console.log(
  "Packaged local preview: " + root + ".zip (not production certified).",
);
