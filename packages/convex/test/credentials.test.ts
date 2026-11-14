import { test } from "node:test";
import assert from "node:assert/strict";

import { createSupaAuth } from "../src/auth/setup";
import { createCredentialsSignIns, credentialsAuthorize } from "../src/auth/credentials";

const ctx = {} as never;
const KAYLA = "users_kayla" as never;

test("an app's authorize names the user, handed what the client sent and the context", async () => {
  let seen: unknown[] = [];
  const run = credentialsAuthorize({
    id: "review-password",
    authorize: async (credentials, actionCtx) => {
      seen = [credentials, actionCtx];
      return { userId: KAYLA };
    },
  });
  assert.deepEqual(await run({ email: "a@b.test", password: "pw" }, ctx), { userId: KAYLA });
  assert.deepEqual(seen, [{ email: "a@b.test", password: "pw" }, ctx]);
});

test("it fails closed: a throw, null or a malformed answer signs nobody in", async () => {
  const answers: Array<() => Promise<unknown>> = [
    async () => {
      throw new Error("boom");
    },
    async () => null,
    async () => ({}),
    async () => ({ userId: "" }),
    async () => "users_kayla",
  ];
  for (const answer of answers) {
    const run = credentialsAuthorize({ id: "x", authorize: answer as never });
    assert.equal(await run({}, ctx), null);
  }
});

test("each config becomes a provider under its own id, and ids must be unique", () => {
  const providers = createCredentialsSignIns([
    { id: "one", authorize: async () => null },
    { id: "two", authorize: async () => null },
  ]);
  assert.deepEqual(providers.map((provider) => (provider as unknown as { options: { id: string } }).options.id), ["one", "two"]);
  assert.deepEqual(createCredentialsSignIns(undefined), []);
  assert.throws(() => createCredentialsSignIns([{ id: "one", authorize: async () => null }, { id: "one", authorize: async () => null }]));
});

test("createSupaAuth registers them alongside the email providers", () => {
  assert.doesNotThrow(() => createSupaAuth({ methods: ["email"], credentials: [{ id: "review-password", authorize: async () => null }] }));
});
