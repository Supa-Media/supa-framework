# @supa-media/convex

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
