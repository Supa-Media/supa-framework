---
"@supa-media/dev-assistant": minor
---

Add `@supa-media/dev-assistant`: an "app improves itself" control plane for
Convex apps — an AI-driven contribution pipeline (spec → build → review → fix →
merge → deploy) extracted from Togather's `devAssistant` module (ADR-029).

- `createDevAssistant(config)` factory (mirrors `createSupaAuth`) returning the
  Convex queries/mutations/actions and an HTTP route registrar for
  `/dev-assistant/callback`, `/dev-assistant/upload`, and `/github/webhook`.
- `supaDevAssistantTables()` composable schema (`devBugs` + `devBugMessages`),
  extensible with a consumer's chat-origination columns.
- A pure, unit-tested pipeline core (`@supa-media/dev-assistant/pipeline`): the
  monotonic status machine, per-run-mode callback policy, severity-capped
  auto-merge gate, HMAC signature verification, and GitHub REST helpers.
- Injection seams for the only app-specific parts — auth, role gate, notifier
  (push/chat), media/upload resolvers, repo/GitHub config, and a configurable
  HMAC header (default `x-supa-signature`).
- `templates/ROUTINE-PROMPT.md` — the three Claude Code Routine prompts with
  documented `{{PLACEHOLDER}}` substitutions.
