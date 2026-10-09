---
"@supa-media/convex": minor
---

`sendTwilioVerification`, `checkTwilioVerification` and `twilioVerifyKeys` from `@supa-media/convex/auth`: Twilio Verify on its own, for an app that signs in with email but wants to confirm a person holds a phone. Twilio keeps the code; only `"approved"` means verified, and missing keys answer `null` rather than pretending.
