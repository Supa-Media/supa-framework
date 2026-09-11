const test = require("node:test");
const assert = require("node:assert/strict");
const { isNativePackage } = require("../src/patterns");

test("classifies PostHog replay bridges as native dependencies", () => {
  assert.equal(isNativePackage("@posthog/react-native-plugin"), true);
  assert.equal(isNativePackage("posthog-react-native-session-replay"), true);
  // The main SDK is JavaScript and loads either native bridge optionally.
  assert.equal(isNativePackage("posthog-react-native"), false);
});
