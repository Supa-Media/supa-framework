import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkTwilioVerification,
  sendTwilioVerification,
  twilioVerifyKeys,
} from "../src/auth/twilioVerify";

const KEYS = { accountSid: "AC_test", authToken: "token_test", serviceSid: "VA_test" };

function fake(status: number, body: unknown, seen: { url?: string; body?: string; auth?: string } = {}) {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.body = String(init.body);
    seen.auth = (init.headers as Record<string, string>).Authorization;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

test("keys come from the environment, and any one missing means none", () => {
  assert.deepEqual(
    twilioVerifyKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b", TWILIO_VERIFY_SERVICE_SID: "c" }),
    { accountSid: "a", authToken: "b", serviceSid: "c" },
  );
  assert.equal(twilioVerifyKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b" }), null);
  assert.equal(twilioVerifyKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: " ", TWILIO_VERIFY_SERVICE_SID: "c" }), null);
});

test("an API key stands in for the auth token, and signs the requests", async () => {
  const keys = twilioVerifyKeys({
    TWILIO_ACCOUNT_SID: "a",
    TWILIO_API_KEY_SID: "SK_test",
    TWILIO_API_KEY_SECRET: "secret_test",
    TWILIO_VERIFY_SERVICE_SID: "c",
  });
  assert.deepEqual(keys, { accountSid: "a", authToken: "secret_test", serviceSid: "c", apiKeySid: "SK_test" });
  // Half an API key is no key.
  assert.equal(twilioVerifyKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_API_KEY_SID: "SK", TWILIO_VERIFY_SERVICE_SID: "c" }), null);
  const seen: { url?: string; body?: string; auth?: string } = {};
  await sendTwilioVerification(keys!, "+15555550100", fake(201, { status: "pending" }, seen));
  assert.equal(seen.auth, `Basic ${btoa("SK_test:secret_test")}`);
});

test("sending posts the number to the service's Verifications, by SMS", async () => {
  const seen: { url?: string; body?: string; auth?: string } = {};
  assert.deepEqual(await sendTwilioVerification(KEYS, "+15555550100", fake(201, { status: "pending" }, seen)), { ok: true });
  assert.equal(seen.url, "https://verify.twilio.com/v2/Services/VA_test/Verifications");
  assert.equal(new URLSearchParams(seen.body).get("To"), "+15555550100");
  assert.equal(new URLSearchParams(seen.body).get("Channel"), "sms");
  assert.equal(seen.auth, `Basic ${btoa("AC_test:token_test")}`);
});

test("a send Twilio refuses says why, in three words at most", async () => {
  assert.deepEqual(await sendTwilioVerification(KEYS, "+1", fake(400, { code: 60200, message: "Invalid parameter `To`" })), { ok: false, reason: "invalid_phone" });
  assert.deepEqual(await sendTwilioVerification(KEYS, "+1", fake(429, { code: 60203 })), { ok: false, reason: "too_many" });
  assert.deepEqual(await sendTwilioVerification(KEYS, "+1", fake(500, "boom")), { ok: false, reason: "failed" });
});

test("only an approved check is approved", async () => {
  const seen: { url?: string; body?: string } = {};
  assert.equal(await checkTwilioVerification(KEYS, "+15555550100", "123456", fake(200, { status: "approved", valid: true }, seen)), "approved");
  assert.equal(seen.url, "https://verify.twilio.com/v2/Services/VA_test/VerificationCheck");
  assert.equal(new URLSearchParams(seen.body).get("Code"), "123456");
  assert.equal(await checkTwilioVerification(KEYS, "+1", "000000", fake(200, { status: "pending", valid: false })), "wrong");
  assert.equal(await checkTwilioVerification(KEYS, "+1", "000000", fake(200, { status: "approved", valid: false })), "wrong");
  assert.equal(await checkTwilioVerification(KEYS, "+1", "000000", fake(404, { code: 20404 })), "wrong");
  assert.equal(await checkTwilioVerification(KEYS, "+1", "000000", fake(429, { code: 60202 })), "too_many");
  assert.equal(await checkTwilioVerification(KEYS, "+1", "000000", fake(500, "boom")), "failed");
});
