import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SIGNATURE_HEADER,
  resolveConfig,
  validateConfig,
  type DevAssistantConfig,
} from "../src/config";
import {
  AUTO_MERGE_SEVERITY_ORDER,
  isWithinAutoMergeCap,
} from "../src/pipeline/severity";

const base: DevAssistantConfig = {
  functionsPath: "functions/devAssistant",
  authenticate: () => "user_1",
  canUseDevAssistant: () => true,
  repo: { owner: "acme", name: "app" } as any,
};

test("validateConfig accepts a minimal valid config", () => {
  assert.doesNotThrow(() => validateConfig(base));
});

test("validateConfig requires functionsPath, canUseDevAssistant, and repo owner/name", () => {
  assert.throws(() => validateConfig({ ...base, functionsPath: "" }), /functionsPath/);
  assert.throws(
    () => validateConfig({ ...base, functionsPath: "functions/x/" }),
    /must not end with a slash/,
  );
  assert.throws(
    () => validateConfig({ ...base, authenticate: undefined as any }),
    /authenticate/,
  );
  assert.throws(
    () => validateConfig({ ...base, canUseDevAssistant: undefined as any }),
    /canUseDevAssistant/,
  );
  assert.throws(
    () => validateConfig({ ...base, repo: { owner: "", name: "" } as any }),
    /repo\.owner/,
  );
  assert.throws(
    () => validateConfig({ ...base, maxFixRounds: 0 }),
    /maxFixRounds/,
  );
});

test("resolveConfig applies defaults", () => {
  const r = resolveConfig(base);
  assert.equal(r.signatureHeader, DEFAULT_SIGNATURE_HEADER);
  assert.equal(r.repo.baseBranch, "main");
  assert.equal(r.repo.branchPrefix, "claude/devbug-");
  assert.equal(r.repo.productionDeployWorkflowName, "Deploy to Production");
  assert.equal(r.maxFixRounds, 3);
  assert.equal(r.defaultAutoMergeMaxSeverity, "low");
  assert.equal(r.productionRetriggerCooldownMs, 15 * 60 * 1000);
  assert.equal(typeof r.notifier.notify, "function");
});

test("resolveConfig lowercases a custom signature header (Togather back-compat)", () => {
  const r = resolveConfig({ ...base, signatureHeader: "X-Togather-Signature" });
  assert.equal(r.signatureHeader, "x-togather-signature");
});

test("default attachment validator allows only r2: paths (safe by default, matches Togather's assertR2Paths)", () => {
  const r = resolveConfig(base);
  assert.doesNotThrow(() => r.assertValidAttachment("r2:chat/abc.png"));
  // Arbitrary http(s) URLs are a tracking-beacon / SSRF surface and must be
  // rejected by default — accepting them is opt-in via a custom
  // `assertValidAttachment` override only.
  assert.throws(() => r.assertValidAttachment("https://cdn.example/x.png"));
  assert.throws(() => r.assertValidAttachment("ftp://evil/x"));
});

test("default attachment validator throws ConvexError (not a plain Error)", () => {
  const r = resolveConfig(base);
  assert.throws(() => r.assertValidAttachment("https://evil.example/x"), (err: any) => {
    assert.equal(err.constructor.name, "ConvexError");
    return true;
  });
});

test("default productionDeployInputs includes confirm: \"deploy\" (matches the workflow's safety gate)", () => {
  const r = resolveConfig(base);
  assert.deepEqual(r.repo.productionDeployInputs, {
    confirm: "deploy",
    update_mode: "silent",
  });
});

test("default media resolver passes http(s) through and drops the rest", () => {
  const r = resolveConfig(base);
  assert.equal(r.resolveMediaUrl("https://x/y.png"), "https://x/y.png");
  assert.equal(r.resolveMediaUrl("r2:chat/abc.png"), undefined);
});

test("auto-merge severity ordering + cap gate", () => {
  assert.deepEqual(AUTO_MERGE_SEVERITY_ORDER, {
    none: -1,
    low: 0,
    medium: 1,
    high: 2,
  });
  // default cap "low": only low-risk auto-merges.
  assert.equal(isWithinAutoMergeCap("low", "low"), true);
  assert.equal(isWithinAutoMergeCap("medium", "low"), false);
  // cap "high": everything up to high.
  assert.equal(isWithinAutoMergeCap("high", "high"), true);
  // cap "none": opt out entirely.
  assert.equal(isWithinAutoMergeCap("low", "none"), false);
  // missing risk never auto-merges.
  assert.equal(isWithinAutoMergeCap(undefined, "high"), false);
});
