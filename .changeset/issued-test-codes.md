---
"@supa-media/convex": minor
---

`testEmail` providers no longer default to the fixed code `000000`. With no `code`, a provider mints a random code nobody sees, and the app issues single-use, expiring codes for the account itself (a verification code row under the provider's id). A fixed `code` is still accepted for local development.
