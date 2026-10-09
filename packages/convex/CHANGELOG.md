# @supa-media/convex

## 1.11.0

### Minor Changes

- dd43a2d: `sendTwilioSms` / `twilioSmsKeys`: text an app-worded message through Twilio's Messaging API (`TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`), for apps that send their own sign-in codes instead of Twilio Verify's wording. `phoneVerify`'s `check` now receives the action context so such an app can answer from its own records.

## 1.10.0

### Minor Changes

- 5b0d919: Twilio Verify: `friendlyName` on the keys (or `TWILIO_VERIFY_FRIENDLY_NAME`) signs texted codes with the app's name, sent as `CustomFriendlyName`, so a Verify service shared by several apps no longer signs every app's codes with one app's name.

## 1.9.0

### Minor Changes

- 86c074a: `createSupaAuth({ phoneVerify })` registers a `phone-verify` sign-in provider: Twilio Verify checks the code, the app says who holds the phone, and it never creates an account.

## 1.8.0

### Minor Changes

- 7ab57f8: `createSupaAuth({ findUserByEmail })`: an app that attaches extra sign-in emails to a user answers which user an address belongs to, and an email sign-in with no auth account yet reaches that user instead of making a new one.
- 7ab57f8: A returning sign-in no longer overwrites the user's `email` or `phone` with the address it came through; it only fills one in when the user has none. An app can attach several sign-in emails to one user (extra `authAccounts` rows) without the last one used replacing the address mail goes to.

## 1.7.1

### Patch Changes

- 1b80e96: `twilioVerifyKeys` accepts a Twilio API key (`TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`) in place of `TWILIO_AUTH_TOKEN`, and the Verify helpers sign with it.

## 1.7.0

### Minor Changes

- b8198cc: `sendTwilioVerification`, `checkTwilioVerification` and `twilioVerifyKeys` from `@supa-media/convex/auth`: Twilio Verify on its own, for an app that signs in with email but wants to confirm a person holds a phone. Twilio keeps the code; only `"approved"` means verified, and missing keys answer `null` rather than pretending.

## 1.6.0

### Minor Changes

- 321ca58: `createSupaAuth({ onUserCreated })`: a hook that runs once per brand-new user, inside the sign-in mutation and after the insert, so an app can schedule a welcome mail or a staff alert that commits only with the account. Returning accounts and sign-in methods linked to an existing user never call it.

## 1.5.0

### Minor Changes

- 3eb6424: `createSupaAuth({ admission })` makes an app invite-only. `canReceiveEmailCode(ctx, email)` is asked before a sign-in code is mailed, and `canCreateUser(ctx, { provider, email, phone })` before a user row is created for somebody with no account, so it covers every provider. Both fail closed; returning accounts are never asked. Omitted, sign-up stays open as before.

## 1.4.0

### Minor Changes

- 38f5769: `createSupaAuth({ testEmail })` now takes a list, registering one fixed-code provider per account, each with its own `id` (starting `test-email-`) and code. Use it for a second production test account such as an app-store or connector-directory reviewer, whose code can come from an environment variable. A single object keeps working unchanged.

## 1.3.0

### Minor Changes

- 626e40d: Add an exact-email, fixed-code auth provider for safely exercising production test accounts without enabling a global OTP bypass.

## 1.2.1

### Patch Changes

- cc38f27: Every package now ships an MIT LICENSE file and a README inside its tarball.

  The repo declared `"license": "MIT"` in all 13 package manifests with no LICENSE
  file anywhere, so npm rendered an MIT badge over a tarball containing no grant.
  Each package now carries a copy of the root LICENSE (a copy, not a symlink — npm
  does not follow symlinks into a tarball) with `"LICENSE"` in its `files` array.

  12 of the 13 also had no README and would have published a blank npm page; they
  now document their real public surface, peer dependencies, and constraints.

  `@supa-media/claude` additionally changes what it scaffolds. Its
  `templates/settings.json` previously wrote
  `{"permissions": {"dangerouslySkipPermissions": true}}` into the consumer's
  `.claude/` — a package that disabled the agent's permission prompts on install.
  It now ships a conservative `permissions.allow` allowlist (routine reversible
  commands: pnpm dev/test/lint/typecheck/build, `npx convex dev|run|logs`,
  read-only git and gh, plus add/commit/checkout) and denies reads of `.env*`.
  `git push`, `git reset --hard`, `gh pr merge`, `convex deploy` and `eas` are
  deliberately left to prompt; widen the allowlist for your own repo.
  `templates/hooks.json` no longer registers a `Stop` hook pointing at a
  `ralph-logger.sh` that was never shipped, and is now an empty starting point.
  Existing `.claude/settings.json` and `.claude/hooks.json` files are untouched
  unless you run `supa-claude sync --force`.

## 1.2.0

### Minor Changes

- 9028425: `createSupaAuth` gains an opt-in `magicLink` provider, for apps that email a
  link which signs the recipient in on click.

  `Email()` from `@convex-dev/auth` hardcodes an `authorize` that refuses any
  verification without a matching `params.email` — right for a code somebody
  types off a screen, wrong for a link whose URL is meant to carry everything.
  Its docstring says to pass `authorize: undefined`; in 0.0.90 that does nothing,
  because the factory builds its result field by field and never spreads `config`.

  It is a **second provider rather than a flag on the first**, and that is the
  whole point. `verifyCodeAndSignIn` derives its rate-limit key from
  `params.email`, so a verification carrying no email is not rate limited at all
  — and the OTP secret is six digits. Clearing the check there would turn a
  one-in-a-million guess against one account into an unthrottled guess against
  every code in flight. The separation holds at redemption because the library
  resolves which `authorize` to run from the provider recorded on the
  verification row, not from what the caller claims.

  `id` is overridden for the same reason: `Email()` hardcodes that too, so the
  second provider would otherwise share the first's id and `getProviderOrThrow`
  could not tell them apart.

  Off by default and gated on the `email` method, so no existing app changes
  behaviour. Callers mint their own codes under `MAGIC_LINK_PROVIDER_ID`; the
  token's entropy is the only secret on this provider, so keep it high.

## 1.1.0

### Minor Changes

- b9e9a70: Add `@supa-media/convex/webhooks`: dependency-free HMAC webhook signature
  verification for Convex `httpAction`s — a generic `verifyHmacSignature` core
  (Web Crypto, timing-safe compare, configurable header prefix/encoding), plus
  `verifyStripeSignature` (timestamp tolerance + secret-rotation support),
  `verifyTwilioSignature` (URL+params signing scheme), and
  `verifySharedSecretHeader` for providers with no signing scheme (e.g. Resend
  inbound email). Ported from production webhook handlers in Fount Studios and
  Togather.

  Add `supaTenantScope` to `@supa-media/convex/schema`: the query-time
  complement to `supaTenantTables` — `rowInTenant`, `getCurrentTenantId`,
  `requireTenantId`, `isMemberOfTenant`, and `activeTenantMemberIds`, generalizing
  Fount Studios' org-scoping discipline (`rowInOrg` / `activeOrgMemberIds` /
  `requireOrg`) and parameterized by `tenantName` to match `supaTenantTables`.

### Patch Changes

- 3c7c3f5: Compare Stripe signatures with a constant-time check in
  `@supa-media/convex/payments`'s `verifyStripeSignature`, matching the
  timing-safe comparison already used in `@supa-media/convex/webhooks`. This
  older, `handleStripeWebhook`-scoped verifier previously compared the computed
  and provided signatures with plain `!==`, which leaks timing information an
  attacker could use to guess a valid signature byte-by-byte.

## 1.0.0

### Major Changes

- f8bd26b: First stable release. The framework's packages are now published to GitHub
  Packages with changesets-managed versions and CHANGELOGs; consumers pin
  `^1.0.0` and update via `pnpm update @supa-media/*`.
