// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require("node:path");
const build = require("./webpack.pagetrail.cjs");
module.exports = (env, argv) => {
  const config = build(env, argv);
  config.entry = {
    "export-demo": "./src/pagetrail/export-demo.ts",
    "dashboard-demo": "./src/pagetrail/dashboard-demo.ts",
    "capture-demo": "./src/pagetrail/capture-demo.ts",
    "crawl-demo": "./src/pagetrail/crawl-demo.ts",
  };
  config.output.path = path.join(__dirname, "dist", "test-export");
  return config;
};
