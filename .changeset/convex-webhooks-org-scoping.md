---
"@supa-media/convex": minor
---

Add `@supa-media/convex/webhooks`: dependency-free HMAC webhook signature
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
