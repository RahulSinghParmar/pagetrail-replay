// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
const path = require("node:path");
const upstream = require("./webpack.config.js");
module.exports = (env, argv) => {
  const config = upstream[0](env, argv);
  config.entry = {
    bg: "./src/pagetrail/background.ts",
    popup: "./src/pagetrail/popup.ts",
    dashboard: "./src/pagetrail/dashboard.ts",
    ui: "./src/pagetrail/reader.ts",
    sw: "./src/sw/main.ts",
    "reader-sw": "./src/pagetrail/reader-sw.ts",
  };
  config.output.path = path.join(__dirname, "dist", "ext");
  config.devtool = false;
  config.module.rules.push({
    test: /offline-reader\.html$/,
    use: "raw-loader",
  });
  const CopyPlugin = require("copy-webpack-plugin");
  config.plugins.push(
    new CopyPlugin({ patterns: [{ from: "LICENSE.md", to: "LICENSE.md" }] }),
  );
  return config;
};
