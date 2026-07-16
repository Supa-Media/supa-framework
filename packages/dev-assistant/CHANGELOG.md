# @supa-media/dev-assistant

## 1.0.0

### Major Changes

- c57402a: First stable release of `@supa-media/dev-assistant`: an "app improves itself"
  control plane for Convex apps — an AI-driven contribution pipeline (spec →
  build → review → fix → merge → deploy) extracted from Togather's
  `devAssistant` module (ADR-029).

  Package version starts at `0.0.0` (unpublished) with a `major` changeset, so
  this bump lands the first release at exactly `1.0.0` — same convention used
  for the framework's original v1.0.0 cut (#12): a `minor` bump on an
  already-`1.0.0` `package.json` would have skipped straight to `1.1.0` on
  first publish.
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
