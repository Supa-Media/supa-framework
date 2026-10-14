---
"@supa-media/claude": minor
---

`sync` now writes `.claude/skills/` too, starting with the `caveman` skill (terse chat and tool chatter, payload verbatim, persisted text plain), and the settings template loads it at session start with a `SessionStart` hook.
