---
"@supa-media/core": patch
---

`SupaConvexProvider` accepts and forwards `shouldHandleCode` to `ConvexAuthProvider`. Left unset, the auth provider treats every `?code=` URL parameter on every route as a sign-in code — so any other OAuth callback (Dropbox, Google, GitHub) redirecting back with `?code=` gets its code redeemed as a login code, verification returns `tokens: null`, and the client stores the sign-out, wiping a working session. Pass a predicate that returns `false` on non-auth callback routes.
