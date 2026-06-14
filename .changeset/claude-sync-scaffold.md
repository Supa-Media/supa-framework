---
"@supa-media/claude": minor
---

Install Claude Code config in scaffolded apps and ship hook scripts.

- `create-supa-app` now seeds `CLAUDE.md` and `.claude/` (settings, hooks, and
  commands including `/review-cycle`) into every new app, and adds a
  `claude:sync` script plus the `@supa-media/claude` dependency so the config
  stays updatable. Previously new apps shipped with no Claude commands.
- `sync` now also installs hook scripts referenced by `hooks.json` (e.g.
  `ralph-logger.sh`) and marks them executable, fixing the previously dangling
  Stop-hook reference.
- The sync logic is now importable (`import { sync } from "@supa-media/claude"`)
  in addition to the `supa-claude` CLI, and accepts an explicit `config` override.
