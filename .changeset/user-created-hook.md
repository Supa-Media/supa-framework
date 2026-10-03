---
"@supa-media/convex": minor
---

`createSupaAuth({ onUserCreated })`: a hook that runs once per brand-new user, inside the sign-in mutation and after the insert, so an app can schedule a welcome mail or a staff alert that commits only with the account. Returning accounts and sign-in methods linked to an existing user never call it.
