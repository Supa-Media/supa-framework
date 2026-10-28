---
"@supa-media/convex": patch
---

A refused Resend send is now logged as `Resend email send failed {status, category}`, where the category is Resend's error name only when it is one of Resend's documented names (otherwise `other`). The response body is no longer printed: it is text the app does not control and could echo the recipient, the code in the message, or anything else. Callers see the same thrown error as before. The no-`RESEND_API_KEY` development path is unchanged.
