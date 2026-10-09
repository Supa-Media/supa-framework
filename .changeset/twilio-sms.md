---
"@supa-media/convex": minor
---

`sendTwilioSms` / `twilioSmsKeys`: text an app-worded message through Twilio's Messaging API (`TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`), for apps that send their own sign-in codes instead of Twilio Verify's wording. `phoneVerify`'s `check` now receives the action context so such an app can answer from its own records.
