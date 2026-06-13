const { createMetroConfig } = require("@supa/metro");

module.exports = createMetroConfig({
  projectRoot: __dirname,
  sharedPackages: ["@{{APP_SLUG}}/shared"],
});
