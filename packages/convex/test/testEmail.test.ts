import { test } from "node:test";
import assert from "node:assert/strict";

import { createTestEmailOtp, TEST_EMAIL_PROVIDER_ID } from "../src/auth/setup";

test("the test provider has its own id and configured fixed code", () => {
  const provider = createTestEmailOtp({ email: "seyi@agentmail.to", code: "000000" });
  assert.equal(provider.id, TEST_EMAIL_PROVIDER_ID);
  assert.equal(
    (provider.options as { generateVerificationToken?: () => string }).generateVerificationToken?.(),
    "000000",
  );
});

test("the test provider accepts only its normalized configured address", async () => {
  const provider = createTestEmailOtp({ email: " Seyi@AgentMail.To " });
  const account = { providerAccountId: "seyi@agentmail.to", type: "email" } as never;

  await assert.doesNotReject(() => provider.authorize!({ email: "SEYI@agentmail.to" }, account));
  await assert.rejects(
    () => provider.authorize!({ email: "customer@example.com" }, account),
    /not available/,
  );
  await assert.rejects(() => provider.authorize!({}, account), /not available/);
});

test("the test provider refuses invalid configuration", () => {
  assert.throws(() => createTestEmailOtp({ email: "", code: "000000" }), /must not be empty/);
  assert.throws(
    () => createTestEmailOtp({ email: "seyi@agentmail.to", code: "1234" }),
    /six digits/,
  );
});
