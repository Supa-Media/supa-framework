# @supa-media/convex

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
