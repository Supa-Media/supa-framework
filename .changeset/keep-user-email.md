---
"@supa-media/convex": minor
---

A returning sign-in no longer overwrites the user's `email` or `phone` with the address it came through; it only fills one in when the user has none. An app can attach several sign-in emails to one user (extra `authAccounts` rows) without the last one used replacing the address mail goes to.
