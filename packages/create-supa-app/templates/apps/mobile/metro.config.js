const { createMetroConfig } = require("@supa-media/metro");

module.exports = createMetroConfig({
  projectRoot: __dirname,
  sharedPackages: ["@{{APP_SLUG}}/shared"],
});
