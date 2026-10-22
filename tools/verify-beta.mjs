// SPDX-License-Identifier: AGPL-3.0-or-later
// Local-only beta gate. It never opens a browser, contacts a website or publishes.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactDir = join(root, "test", "artifacts", "beta-verification");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const startedAt = new Date().toISOString();
const commandResults = [];

await mkdir(artifactDir, { recursive: true });

async function run(name, command, args, { json = false } = {}) {
  console.log(`[beta] ${name}...`);
  const result = await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status, signal) =>
      resolveRun({ status, signal, stdout, stderr }),
    );
  });
  const passed = result.status === 0;
  commandResults.push({
    name,
    command: [command, ...args].map((value) => basename(value)),
    passed,
    status: result.status,
    signal: result.signal,
    outputTail: (result.stdout + "\n" + result.stderr).trim().slice(-4000),
  });
  if (!passed) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${name} failed with status ${result.status}`);
  }
  console.log(`[beta] ${name}: passed`);
  return json ? JSON.parse(result.stdout) : result;
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files.sort();
}

async function requireFiles(rootDir, names) {
  for (const name of names) await access(join(rootDir, name));
}

async function verifyHashes(packageRoot) {
  const lines = (await readFile(join(packageRoot, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n");
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`Malformed checksum line: ${line}`);
    const actual = createHash("sha256")
      .update(await readFile(join(packageRoot, match[2])))
      .digest("hex");
    if (actual !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
  }
  return lines.length;
}

let report;
try {
  await run("PageTrail tests", npm, ["run", "test:pagetrail"]);
  await run("TypeScript", npm, ["run", "typecheck"]);
  const lint = await run(
    "Source lint",
    join(root, "node_modules", ".bin", "eslint"),
    ["src/pagetrail/", "--format", "json"],
    { json: true },
  );
  const lintErrors = lint.reduce((sum, file) => sum + file.errorCount, 0);
  const lintWarnings = lint.reduce((sum, file) => sum + file.warningCount, 0);
  if (lintErrors) throw new Error(`Source lint reported ${lintErrors} errors.`);

  await run("Synthetic demo build", npm, ["run", "build:export-demo"]);
  await run("Reader build", npm, ["run", "build:reader"]);
  await run("Extension build and beta package", npm, [
    "run",
    "package:pagetrail",
  ]);

  const release = JSON.parse(
    await readFile(join(root, "pagetrail-release.json"), "utf8"),
  );
  const label = `${release.version}-${release.channel}.${release.iteration}`;
  const packageRoot = join(root, "release", `PageTrail-Replay-${label}`);
  const packageZip = packageRoot + ".zip";
  await requireFiles(packageRoot, [
    "extension/manifest.json",
    "extension/bg.js",
    "extension/popup.html",
    "extension/dashboard.html",
    "reader/index.html",
    "reader/serve-reader.mjs",
    "interactive-demo.wacz",
    "BETA-ACCEPTANCE.md",
    "BETA-RELEASE.md",
    "PAGETRAIL.md",
    "VERIFICATION.md",
    "SHA256SUMS",
  ]);

  const manifest = JSON.parse(
    await readFile(join(packageRoot, "extension", "manifest.json"), "utf8"),
  );
  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== release.version ||
    manifest.name !== "PageTrail Replay (Local Preview)"
  )
    throw new Error("Packaged extension manifest identity is incorrect.");
  if (manifest.update_url)
    throw new Error("Beta manifest must not define an update URL.");

  const packagedFiles = await walk(packageRoot);
  const forbidden = packagedFiles.filter((path) =>
    /(?:^|\/)(?:\.env(?:\..*)?|recordings?|captures?|browser-profile[^/]*)$|\.(?:pem|key|log)$/i.test(
      relative(packageRoot, path),
    ),
  );
  if (forbidden.length)
    throw new Error(
      `Private or diagnostic files entered the package: ${forbidden.join(", ")}`,
    );
  const waczFiles = packagedFiles
    .map((path) => relative(packageRoot, path))
    .filter((path) => path.endsWith(".wacz"));
  if (
    waczFiles.length !== 1 ||
    waczFiles[0] !== "interactive-demo.wacz"
  )
    throw new Error(`Unexpected WACZ files in package: ${waczFiles.join(", ")}`);

  const checksumCount = await verifyHashes(packageRoot);
  const unzip = process.platform === "win32" ? "tar" : "/usr/bin/unzip";
  const unzipArgs =
    process.platform === "win32" ? ["-tf", packageZip] : ["-t", packageZip];
  await run("Package ZIP integrity", unzip, unzipArgs);

  report = {
    schema: 1,
    phase: "Phase 6 — Practical beta verification",
    status: "AUTOMATED_GATE_PASSED",
    startedAt,
    finishedAt: new Date().toISOString(),
    release: label,
    automatedScope: [
      "91 PageTrail tests",
      "TypeScript",
      "source lint",
      "production demo, reader and extension builds",
      "beta package structure",
      "packaged SHA-256 checksums",
      "package ZIP integrity",
      "private-file and unexpected-WACZ exclusion",
    ],
    manualScope: "See BETA-ACCEPTANCE.md for installed Edge checks.",
    lint: { errors: lintErrors, warnings: lintWarnings },
    package: {
      directory: relative(root, packageRoot),
      zip: relative(root, packageZip),
      zipBytes: (await stat(packageZip)).size,
      files: packagedFiles.length,
      checksums: checksumCount,
    },
    commands: commandResults,
  };
  console.log(`[beta] automated gate passed: ${report.package.zip}`);
} catch (error) {
  report = {
    schema: 1,
    phase: "Phase 6 — Practical beta verification",
    status: "AUTOMATED_GATE_FAILED",
    startedAt,
    finishedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    commands: commandResults,
  };
  process.exitCode = 1;
} finally {
  const reportPath = join(artifactDir, "beta-verification.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`[beta] report: ${relative(root, reportPath)}`);
}
