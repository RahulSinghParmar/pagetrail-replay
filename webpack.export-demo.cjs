// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require("node:path");
const build = require("./webpack.pagetrail.cjs");
module.exports = (env, argv) => {
  const config = build(env, argv);
  config.entry = { "export-demo": "./src/pagetrail/export-demo.ts" };
  config.output.path = path.join(__dirname, "dist", "test-export");
  return config;
};
