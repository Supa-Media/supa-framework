---
"@supa-media/convex": patch
---

Email sign-in codes are now exactly uniform over 100000-999999. A 32-bit draw at or above the last whole multiple of 900000 is drawn again instead of taken modulo, removing a ~0.02% bias toward low codes.
