import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  computeHmacHex,
  timingSafeEqual,
  verifyCallbackSignature,
  verifyGithubSignature,
} from "../src/pipeline/signature";

test("timingSafeEqual: equal strings match, unequal do not", () => {
  assert.equal(timingSafeEqual("abc123", "abc123"), true);
  assert.equal(timingSafeEqual("abc123", "abc124"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});

test("computeHmacHex matches node:crypto's HMAC-SHA256 hex digest", async () => {
  const secret = "dev-assistant-secret";
  const payload = JSON.stringify({ bugId: "b1", routineRunId: "r1", status: "IN_REVIEW" });
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  assert.equal(await computeHmacHex(secret, payload), expected);
});

test("verifyCallbackSignature accepts a valid bare-hex signature (Routine callback)", async () => {
  const secret = "DEV_ASSISTANT_CALLBACK_SECRET-value";
  const payload = JSON.stringify({ bugId: "b1", routineRunId: "r1", status: "CODE_REVIEW", prUrl: "https://github.com/o/r/pull/7" });
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  assert.equal(await verifyCallbackSignature(payload, sig, secret), true);
});

test("verifyCallbackSignature is case-insensitive on the hex digest", async () => {
  const secret = "s3cr3t";
  const payload = "{}";
  const sig = createHmac("sha256", secret).update(payload).digest("hex").toUpperCase();
  assert.equal(await verifyCallbackSignature(payload, sig, secret), true);
});

test("verifyCallbackSignature rejects a tampered body, wrong secret, and missing sig", async () => {
  const secret = "s3cr3t";
  const payload = "{\"a\":1}";
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  assert.equal(await verifyCallbackSignature("{\"a\":2}", sig, secret), false);
  assert.equal(await verifyCallbackSignature(payload, sig, "other-secret"), false);
  assert.equal(await verifyCallbackSignature(payload, null, secret), false);
  assert.equal(await verifyCallbackSignature(payload, sig, ""), false);
});

test("verifyGithubSignature accepts a valid sha256=-prefixed signature", async () => {
  const secret = "gh-webhook-secret";
  const payload = JSON.stringify({ action: "closed", pull_request: { merged: true } });
  const hex = createHmac("sha256", secret).update(payload).digest("hex");
  assert.equal(await verifyGithubSignature(payload, `sha256=${hex}`, secret), true);
});

test("verifyGithubSignature rejects a missing prefix or bad digest", async () => {
  const secret = "gh-webhook-secret";
  const payload = "{}";
  const hex = createHmac("sha256", secret).update(payload).digest("hex");
  assert.equal(await verifyGithubSignature(payload, hex, secret), false); // no prefix
  assert.equal(await verifyGithubSignature(payload, "sha256=deadbeef", secret), false);
});
