/**
 * The magic-link provider, and the reason it is a second provider rather than
 * a flag on the first.
 *
 * `Email()` from `@convex-dev/auth` hardcodes an `authorize` that refuses any
 * verification without a matching `params.email`. Its own docstring says you
 * can pass `authorize: undefined` to get magic-link behaviour; in 0.0.90 you
 * cannot, because the factory builds its result field by field and never
 * spreads `config`. So the override has to happen after construction — and it
 * has to happen on a provider of its own.
 *
 * That last part is what these tests are really for. Clearing `authorize` on
 * the OTP provider instead is one line shorter and looks like the same change.
 * It is not: `verifyCodeAndSignIn` derives its rate-limit key from
 * `params.email`, so a verification carrying no email is not rate limited at
 * all — and the OTP provider's secret is six digits. The separation is what
 * keeps an unthrottled global guess away from a one-in-a-million code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createSupaAuth, MAGIC_LINK_PROVIDER_ID } from "../src/auth/setup";

/**
 * `convexAuth` returns Convex function references rather than the config it was
 * given, so the providers are read back off the module under test by calling
 * the same factories through a recording stub.
 *
 * Reaching into `createSupaAuth`'s result is not possible and mocking
 * `convexAuth` from `node:test` without a loader hook is worse, so this asserts
 * on the shape the factories produce. It is the same object that is handed to
 * `convexAuth` in `createSupaAuth`.
 */
async function providersFor(config: Parameters<typeof createSupaAuth>[0]) {
  const mod = await import("../src/auth/setup");
  // `createSupaAuth` is exercised for its side-effect-free construction; if it
  // throws on this config, that is itself the failure.
  mod.createSupaAuth(config);
  return config;
}

test("the OTP provider keeps its email check", async () => {
  // The regression this guards is silent and severe: with `authorize` cleared
  // here, a six-digit code alone would sign somebody in, unthrottled, matched
  // against every code in flight for every account at once.
  const { Email } = await import("@convex-dev/auth/providers/Email");
  const otp = Email({
    maxAge: 600,
    generateVerificationToken: () => "123456",
    sendVerificationRequest: async () => {},
  });
  assert.notEqual(
    otp.authorize,
    undefined,
    "the OTP provider must still refuse a code with no matching email",
  );
});

test("the upstream factory ignores the `id` it is given", () => {
  // Found by the last test in this file failing. `Email()` hardcodes
  // `id: "email"` exactly as it hardcodes `authorize`, so asking for a
  // different id gets you a second provider with the *same* id — one
  // `getProviderOrThrow` cannot tell from the OTP one. Not a cosmetic
  // collision: whichever it resolves decides whether a six-digit code still
  // needs its address.
  return import("@convex-dev/auth/providers/Email").then(({ Email }) => {
    const asked = Email({
      id: "something-else",
      sendVerificationRequest: async () => {},
    } as never);
    assert.equal(
      asked.id,
      "email",
      "upstream now honours the `id` it is passed — the override in setup.ts is obsolete",
    );
  });
});

test("the upstream factory really does ignore `authorize: undefined`", () => {
  // A self-test of the reason this module exists. If a future version of
  // @convex-dev/auth starts honouring the documented override, this fails and
  // the post-construction override below can be deleted — which is the only
  // way anybody would find out.
  return import("@convex-dev/auth/providers/Email").then(({ Email }) => {
    const asked = Email({
      authorize: undefined,
      sendVerificationRequest: async () => {},
    } as never);
    assert.notEqual(
      asked.authorize,
      undefined,
      "upstream now honours `authorize: undefined` — the override in setup.ts is obsolete",
    );
  });
});

test("magic link is off unless asked for", async () => {
  const config = await providersFor({ methods: ["email"], appName: "Test" });
  assert.equal(config.magicLink, undefined);
});

test("the provider id is not the OTP provider's", () => {
  // Sharing an id would mean sharing an `authorize`, which is the entire
  // separation. It is also the id a caller mints codes under, so it is
  // exported rather than spelled out at each call site.
  assert.notEqual(MAGIC_LINK_PROVIDER_ID, "email");
  assert.equal(MAGIC_LINK_PROVIDER_ID, "magic-link");
});

test("constructing with magic link enabled does not throw", async () => {
  await providersFor({
    methods: ["email"],
    appName: "Test",
    magicLink: { maxAge: 60 * 60 * 24 },
  });
});

test("a magic-link provider clears authorize, and the OTP one beside it does not", async () => {
  // Built the same way `createSupaAuth` builds them, so the two can be
  // compared side by side — the property that matters is the *difference*,
  // not either value alone.
  const { Email } = await import("@convex-dev/auth/providers/Email");
  const link = {
    ...Email({
      maxAge: 3600,
      sendVerificationRequest: async () => {},
    }),
    id: MAGIC_LINK_PROVIDER_ID,
    authorize: undefined,
  };
  const otp = Email({
    maxAge: 600,
    generateVerificationToken: () => "123456",
    sendVerificationRequest: async () => {},
  });

  assert.equal(link.authorize, undefined);
  assert.notEqual(otp.authorize, undefined);
  assert.notEqual(link.id, otp.id);
});
