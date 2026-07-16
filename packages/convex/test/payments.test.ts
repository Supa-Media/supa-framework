/**
 * Vector tests for `@supa-media/convex/payments`'s `verifyStripeSignature`.
 *
 * This is the OLDER, `handleStripeWebhook`-scoped signature verifier (distinct
 * from `../src/webhooks/stripe.ts`'s verifier — see the note in
 * `../src/webhooks/index.ts` explaining why the two aren't merged). It used to
 * compare the computed and provided signatures with plain `!==`, which is not
 * constant-time; it now delegates to `timingSafeEqual` from `../src/webhooks/hmac`.
 * These tests exercise that comparison path directly: a valid signature must
 * still verify, and a mismatched one must still be rejected.
 *
 * Run: `node --import ./test/register.mjs --test test/*.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { verifyStripeSignature } from "../src/payments/index";

function buildStripeSignatureHeader(
  secret: string,
  payload: string,
  timestamp: number,
): string {
  const signedPayload = `${timestamp}.${payload}`;
  const v1 = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

test("verifyStripeSignature (payments): accepts a valid signature and returns the parsed event", async () => {
  const secret = "whsec_payments_test";
  const payload = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { id: "evt_123" } },
  });
  const header = buildStripeSignatureHeader(secret, payload, Math.floor(Date.now() / 1000));

  const event = await verifyStripeSignature(payload, header, secret);
  assert.equal(event.type, "checkout.session.completed");
  assert.equal(event.data.object.id, "evt_123");
});

test("verifyStripeSignature (payments): rejects an invalid signature", async () => {
  const secret = "whsec_payments_test";
  const payload = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { id: "evt_123" } },
  });
  // Signed with a different secret than the one verification is given, so the
  // computed and provided signatures won't match.
  const header = buildStripeSignatureHeader("whsec_wrong", payload, Math.floor(Date.now() / 1000));

  await assert.rejects(
    () => verifyStripeSignature(payload, header, secret),
    /Invalid Stripe webhook signature/,
  );
});
