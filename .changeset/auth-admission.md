---
"@supa-media/convex": minor
---

`createSupaAuth({ admission })` makes an app invite-only. `canReceiveEmailCode(ctx, email)` is asked before a sign-in code is mailed, and `canCreateUser(ctx, { provider, email, phone })` before a user row is created for somebody with no account, so it covers every provider. Both fail closed; returning accounts are never asked. Omitted, sign-up stays open as before.
