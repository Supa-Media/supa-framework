---
"@supa-media/convex": patch
---

Compare Stripe signatures with a constant-time check in
`@supa-media/convex/payments`'s `verifyStripeSignature`, matching the
timing-safe comparison already used in `@supa-media/convex/webhooks`. This
older, `handleStripeWebhook`-scoped verifier previously compared the computed
and provided signatures with plain `!==`, which leaks timing information an
attacker could use to guess a valid signature byte-by-byte.
