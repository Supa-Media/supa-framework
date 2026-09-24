---
"@supa-media/scripts": patch
---

`supa-architecture-check --base` now compares against the commit the branch
forked from (`git merge-base`), not the base branch's current tip. Against the
tip, a baseline entry that another merged change had removed read as one the
branch added, failing every open branch until it merged the base.
