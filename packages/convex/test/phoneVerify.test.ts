import { test } from "node:test";
import assert from "node:assert/strict";

import { createSupaAuth } from "../src/auth/setup";
import { createPhoneVerifySignIn, PHONE_VERIFY_PROVIDER_ID, phoneVerifyAuthorize } from "../src/auth/phoneVerify";

const ctx = {} as never;
const KAYLA = "users_kayla" as never;

function authorize(overrides: {
  verdict?: "approved" | "wrong" | "too_many" | "failed";
  holder?: string | null;
  mayCheck?: () => Promise<boolean>;
}) {
  const asked: string[] = [];
  const run = phoneVerifyAuthorize({
    check: async (phone, code) => {
      asked.push(`${phone}:${code}`);
      return overrides.verdict ?? "approved";
    },
    findUserByPhone: async () => (overrides.holder === undefined ? KAYLA : (overrides.holder as never)),
    ...(overrides.mayCheck ? { mayCheck: overrides.mayCheck } : {}),
  });
  return { run, asked };
}

test("an approved code signs in whoever holds the phone", async () => {
  const { run, asked } = authorize({});
  assert.deepEqual(await run({ phone: "+14155550100", code: "123 456" }, ctx), { userId: KAYLA });
  assert.deepEqual(asked, ["+14155550100:123456"]);
});

test("anything but approved signs nobody in", async () => {
  for (const verdict of ["wrong", "too_many", "failed"] as const) {
    assert.equal(await authorize({ verdict }).run({ phone: "+14155550100", code: "123456" }, ctx), null, verdict);
  }
});

test("a phone nobody holds is refused even with a right code: it never makes an account", async () => {
  assert.equal(await authorize({ holder: null }).run({ phone: "+14155550100", code: "123456" }, ctx), null);
});

test("a malformed phone or code is refused before Twilio is asked", async () => {
  const { run, asked } = authorize({});
  for (const credentials of [
    { phone: "4155550100", code: "123456" },
    { phone: "+14155550100", code: "12ab56" },
    { phone: "+14155550100" },
    { code: "123456" },
    { phone: 14155550100, code: 123456 },
  ]) {
    assert.equal(await run(credentials as never, ctx), null);
  }
  assert.deepEqual(asked, []);
});

test("the app's limit is asked first and fails closed", async () => {
  const spent = authorize({ mayCheck: async () => false });
  assert.equal(await spent.run({ phone: "+14155550100", code: "123456" }, ctx), null);
  assert.deepEqual(spent.asked, []);
  const broken = authorize({
    mayCheck: async () => {
      throw new Error("down");
    },
  });
  assert.equal(await broken.run({ phone: "+14155550100", code: "123456" }, ctx), null);
  assert.deepEqual(broken.asked, []);
});

test("the provider has its own id, and is registered only when configured", () => {
  // `@convex-dev/auth` merges `options` over the provider when it is
  // registered, so that is where the id it will answer to lives.
  const provider = createPhoneVerifySignIn({ findUserByPhone: async () => null }) as {
    type: string;
    options: { id: string };
  };
  assert.equal(provider.options.id, PHONE_VERIFY_PROVIDER_ID);
  assert.equal(provider.type, "credentials");
  assert.doesNotThrow(() => createSupaAuth({ methods: ["email"], phoneVerify: { findUserByPhone: async () => null } }));
});

test("an app's own check is handed the action context, to read its own records", async () => {
  const own = { db: "the app's" } as never;
  let seen: unknown;
  const run = phoneVerifyAuthorize({
    check: async (_phone, _code, actionCtx) => {
      seen = actionCtx;
      return "approved";
    },
    findUserByPhone: async () => KAYLA,
  });
  assert.deepEqual(await run({ phone: "+14155550100", code: "123456" }, own), { userId: KAYLA });
  assert.equal(seen, own);
});
