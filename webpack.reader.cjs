// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require("node:path");
const base = require("./webpack.pagetrail.cjs");
module.exports = (env, argv) => {
  const config = base(env, argv);
  config.entry = {
    ui: "./src/pagetrail/reader.ts",
    "reader-sw": "./src/pagetrail/reader-sw.ts",
  };
  config.output.path = path.join(__dirname, "dist", "reader");
  // Reader-only staging must not generate recorder manifests or release files.
  config.plugins = config.plugins.filter(
    (p) => !["CopyPlugin", "GenerateJsonPlugin"].includes(p.constructor.name),
  );
  return config;
};
