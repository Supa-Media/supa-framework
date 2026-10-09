import { test } from "node:test";
import assert from "node:assert/strict";

import { sendTwilioSms, twilioSmsKeys } from "../src/auth/twilioSms";

const KEYS = { accountSid: "AC_test", authToken: "token_test", from: { number: "+15555550199" } };

function fake(status: number, body: unknown, seen: { url?: string; body?: string; auth?: string } = {}) {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.body = String(init.body);
    seen.auth = (init.headers as Record<string, string>).Authorization;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

test("keys need an account, a secret and a sender", () => {
  assert.deepEqual(
    twilioSmsKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b", TWILIO_FROM_NUMBER: " +15555550199 " }),
    { accountSid: "a", authToken: "b", from: { number: "+15555550199" } },
  );
  assert.deepEqual(
    twilioSmsKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_API_KEY_SID: "SK", TWILIO_API_KEY_SECRET: "s", TWILIO_MESSAGING_SERVICE_SID: "MG1" }),
    { accountSid: "a", authToken: "s", apiKeySid: "SK", from: { messagingServiceSid: "MG1" } },
  );
  assert.equal(twilioSmsKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b" }), null);
  assert.equal(twilioSmsKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_FROM_NUMBER: "+15555550199" }), null);
  assert.equal(twilioSmsKeys({ TWILIO_ACCOUNT_SID: "a", TWILIO_API_KEY_SID: "SK", TWILIO_FROM_NUMBER: "+1555" }), null);
});

test("sending posts the app's own words to Messages, from its number", async () => {
  const seen: { url?: string; body?: string; auth?: string } = {};
  assert.deepEqual(await sendTwilioSms(KEYS, "+15555550100", "123456 is your Context code", fake(201, { sid: "SM1" }, seen)), { ok: true });
  assert.equal(seen.url, "https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json");
  const form = new URLSearchParams(seen.body);
  assert.equal(form.get("To"), "+15555550100");
  assert.equal(form.get("From"), "+15555550199");
  assert.equal(form.get("Body"), "123456 is your Context code");
  assert.equal(form.has("MessagingServiceSid"), false);
  assert.equal(seen.auth, `Basic ${btoa("AC_test:token_test")}`);
});

test("a messaging service sends in place of a number, signed by an API key", async () => {
  const seen: { url?: string; body?: string; auth?: string } = {};
  await sendTwilioSms(
    { accountSid: "AC_test", authToken: "secret", apiKeySid: "SK_test", from: { messagingServiceSid: "MG_test" } },
    "+15555550100",
    "hi",
    fake(201, {}, seen),
  );
  const form = new URLSearchParams(seen.body);
  assert.equal(form.get("MessagingServiceSid"), "MG_test");
  assert.equal(form.has("From"), false);
  assert.equal(seen.auth, `Basic ${btoa("SK_test:secret")}`);
});

test("a refused send says why", async () => {
  assert.deepEqual(await sendTwilioSms(KEYS, "+1", "x", fake(400, { code: 21211 })), { ok: false, reason: "invalid_phone" });
  assert.deepEqual(await sendTwilioSms(KEYS, "+1", "x", fake(429, { code: 20429 })), { ok: false, reason: "too_many" });
  assert.deepEqual(await sendTwilioSms(KEYS, "+1", "x", fake(500, "boom")), { ok: false, reason: "failed" });
});
