---
"@supa-media/convex": patch
---

`twilioVerifyKeys` accepts a Twilio API key (`TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`) in place of `TWILIO_AUTH_TOKEN`, and the Verify helpers sign with it.
