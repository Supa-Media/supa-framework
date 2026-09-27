import { test } from "node:test";
import assert from "node:assert/strict";

import { createTestEmailOtp, createTestEmailOtps, TEST_EMAIL_PROVIDER_ID } from "../src/auth/setup";

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

test("a list registers one provider per account, each with its own id and code", async () => {
  const providers = createTestEmailOtps([
    { email: "seyi@agentmail.to", code: "000000" },
    { email: "reviewer@example.com", code: "482913", id: "test-email-reviewer" },
  ]);
  assert.deepEqual(
    providers.map((provider) => provider.id),
    [TEST_EMAIL_PROVIDER_ID, "test-email-reviewer"],
  );
  const reviewer = providers[1]!;
  assert.equal(
    (reviewer.options as { generateVerificationToken?: () => string }).generateVerificationToken?.(),
    "482913",
  );
  const theirAccount = { providerAccountId: "reviewer@example.com", type: "email" } as never;
  const seyisAccount = { providerAccountId: "seyi@agentmail.to", type: "email" } as never;
  await assert.doesNotReject(() => reviewer.authorize!({ email: "reviewer@example.com" }, theirAccount));
  // The reviewer's code must not open the other test account, nor a customer's.
  await assert.rejects(() => reviewer.authorize!({ email: "seyi@agentmail.to" }, seyisAccount), /not available/);
  await assert.rejects(() => reviewer.authorize!({ email: "customer@example.com" }, theirAccount), /not available/);
});

test("a single account and no account keep working as before", () => {
  assert.deepEqual(createTestEmailOtps(undefined), []);
  assert.deepEqual(
    createTestEmailOtps({ email: "seyi@agentmail.to" }).map((provider) => provider.id),
    [TEST_EMAIL_PROVIDER_ID],
  );
});

test("a list refuses a shared id, a shared address, or an id that could shadow another provider", () => {
  assert.throws(
    () => createTestEmailOtps([{ email: "a@example.com" }, { email: "b@example.com" }]),
    /own id/,
  );
  assert.throws(
    () =>
      createTestEmailOtps([
        { email: "a@example.com" },
        { email: "A@example.com ", id: "test-email-second" },
      ]),
    /own email/,
  );
  for (const id of ["email", "magic-link", "phone", "test-emailx", "test-email-", "Test-Email-X"]) {
    assert.throws(() => createTestEmailOtp({ email: "a@example.com", id }), /testEmail.id/, id);
  }
});
