---
"@supa-media/convex": minor
---

`createSupaAuth` gains an opt-in `magicLink` provider, for apps that email a
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
