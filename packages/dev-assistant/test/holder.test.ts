import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setDevAssistantConfig,
  getDevAssistantConfig,
  getDevAssistantRefs,
  __resetDevAssistantConfigForTests,
} from "../src/holder";
import type { DevAssistantConfig } from "../src/config";

const base: DevAssistantConfig = {
  functionsPath: "functions/devAssistant",
  authenticate: () => "user_1",
  canUseDevAssistant: () => true,
  repo: { owner: "acme", name: "app" } as any,
};

test("getDevAssistantConfig throws a descriptive setup error when unset", () => {
  __resetDevAssistantConfigForTests();
  assert.throws(
    () => getDevAssistantConfig(),
    /setDevAssistantConfig/,
    "the error must name the setup step so a missing config-module import is obvious",
  );
});

test("getDevAssistantRefs throws the same setup error when unset", () => {
  __resetDevAssistantConfigForTests();
  assert.throws(() => getDevAssistantRefs(), /setDevAssistantConfig/);
});

test("setDevAssistantConfig resolves + stores the config (defaults applied)", () => {
  const resolved = setDevAssistantConfig(base);
  // resolveConfig defaults are applied (proven in config.test.ts).
  assert.equal(resolved.functionsPath, "functions/devAssistant");
  assert.equal(resolved.maxFixRounds, 3);
  // The holder now returns the same resolved object.
  assert.equal(getDevAssistantConfig().functionsPath, "functions/devAssistant");
  assert.equal(getDevAssistantConfig().maxFixRounds, 3);
});

test("setDevAssistantConfig builds refs from functionsPath", () => {
  setDevAssistantConfig(base);
  const refs = getDevAssistantRefs();
  // refs are opaque FunctionReferences; assert the shape is wired (not throwing).
  assert.ok(refs.bugs.getBug);
  assert.ok(refs.actions.dispatchBug);
  assert.ok(refs.maintainers.getAutoMergeCapForUser);
});

test("setDevAssistantConfig validates (invalid config throws)", () => {
  assert.throws(
    () => setDevAssistantConfig({ ...base, functionsPath: "" }),
    /functionsPath/,
  );
});
