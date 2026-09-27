---
"@supa-media/convex": minor
---

`createSupaAuth({ testEmail })` now takes a list, registering one fixed-code provider per account, each with its own `id` (starting `test-email-`) and code. Use it for a second production test account such as an app-store or connector-directory reviewer, whose code can come from an environment variable. A single object keeps working unchanged.
