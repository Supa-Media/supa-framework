"use strict";

/**
 * Regression test for the preset/plugin namespace mismatch.
 *
 * The preset (and the legacy `configs.recommended` export) must register the
 * plugin under the SAME namespace that its rule ids use — otherwise ESLint
 * fails to resolve every rule with "Definition for rule '@supa-media/...'
 * was not found" and consumers are forced to manually re-register the
 * plugin under the correct namespace just to use the preset out of the box.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const plugin = require("../src/index");
const preset = require("../src/preset");

/**
 * Given a flat-config-style object with `plugins` (namespace -> plugin
 * object) and `rules` (namespace/rule-name -> severity), assert every rule
 * id resolves to a rule actually defined on a registered plugin.
 */
function assertRulesResolve(config, label) {
  const ruleIds = Object.keys(config.rules || {});
  assert.ok(
    ruleIds.length > 0,
    `${label}: expected at least one rule to check`,
  );

  for (const ruleId of ruleIds) {
    const slash = ruleId.indexOf("/");
    assert.ok(
      slash !== -1,
      `${label}: rule id "${ruleId}" is not namespaced`,
    );

    const namespace = ruleId.slice(0, slash);
    const ruleName = ruleId.slice(slash + 1);

    const registeredPlugin = config.plugins?.[namespace];
    assert.ok(
      registeredPlugin,
      `${label}: rule "${ruleId}" references namespace "${namespace}", ` +
        `but no plugin is registered under that namespace in this config's ` +
        `\`plugins\` map (registered: ${Object.keys(config.plugins || {}).join(", ") || "<none>"})`,
    );

    assert.ok(
      registeredPlugin.rules && registeredPlugin.rules[ruleName],
      `${label}: rule "${ruleName}" is not defined on the plugin ` +
        `registered under "${namespace}"`,
    );
  }
}

test("preset.js: every rule id resolves to a plugin registered in its own config's `plugins` map", () => {
  const flatConfigWithRules = preset.find(
    (entry) => entry && entry.plugins && entry.rules,
  );
  assert.ok(flatConfigWithRules, "preset should have a config block with both `plugins` and `rules`");
  assertRulesResolve(flatConfigWithRules, "preset.js");
});

test("index.js: configs.recommended registers its plugin under the namespace its rule ids use", () => {
  const recommended = plugin.configs.recommended;
  assert.ok(recommended, "plugin.configs.recommended should exist");

  const ruleIds = Object.keys(recommended.rules || {});
  assert.ok(ruleIds.length > 0, "recommended config should define rules");

  const namespaces = new Set(
    ruleIds.map((id) => id.slice(0, id.indexOf("/"))),
  );
  assert.equal(
    namespaces.size,
    1,
    `recommended config rule ids use inconsistent namespaces: ${[...namespaces].join(", ")}`,
  );
  const [namespace] = namespaces;

  // Legacy `.eslintrc` format registers plugins by name string, not by
  // object reference — assert the registered name matches the namespace
  // the rule ids actually use.
  assert.ok(
    Array.isArray(recommended.plugins) && recommended.plugins.includes(namespace),
    `recommended.plugins (${JSON.stringify(recommended.plugins)}) does not ` +
      `include "${namespace}", the namespace used by its rule ids`,
  );

  // And the rule names themselves must exist on the actual plugin object.
  for (const ruleId of ruleIds) {
    const ruleName = ruleId.slice(ruleId.indexOf("/") + 1);
    assert.ok(
      plugin.rules[ruleName],
      `rule "${ruleName}" (from "${ruleId}") is not defined on the plugin`,
    );
  }
});

test("preset.js and index.js agree on the plugin namespace", () => {
  const flatConfigWithRules = preset.find(
    (entry) => entry && entry.plugins && entry.rules,
  );
  const presetNamespace = Object.keys(flatConfigWithRules.plugins)[0];

  const recommendedRuleIds = Object.keys(plugin.configs.recommended.rules);
  const recommendedNamespace = recommendedRuleIds[0].slice(
    0,
    recommendedRuleIds[0].indexOf("/"),
  );

  assert.equal(
    presetNamespace,
    recommendedNamespace,
    "preset.js and index.js's configs.recommended must use the same plugin namespace",
  );
});
