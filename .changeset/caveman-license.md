---
"@supa-media/claude": patch
---

The caveman skill now ships with its Apache-2.0 license text, the SessionStart hook uses `${CLAUDE_PROJECT_DIR}` so it also works in PowerShell, `sync --dry-run` no longer creates directories, and the hook runs only on `startup|clear` so "stop caveman" survives resume and compaction.
