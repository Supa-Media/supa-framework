# Supa Framework — Agent Instructions

Guidelines for AI agents (Claude, Cursor, Copilot, etc.) working on the
**supa-framework** monorepo (the framework itself — not an app scaffolded from it).

This repo is the source of `@supa-media/*` packages, the `create-supa-app` scaffolder, and
the reusable GitHub workflows. For what each package does and the overall design, see
[README.md](./README.md) and [docs/DESIGN.md](./docs/DESIGN.md).

## Key Docs

- **[docs/DESIGN.md](./docs/DESIGN.md)** — framework design, package architecture,
  enforced conventions.
- **[docs/SECRETS.md](./docs/SECRETS.md)** — the canonical secrets flow (1Password →
  GitHub → server env) for every Supa app.
- **[docs/PUBLISHING.md](./docs/PUBLISHING.md)** — **to publish a Supa app (Convex +
  web + iOS/TestFlight + OTA), follow this guide.** It's the battle-tested lifecycle
  from `create-supa-app` to TestFlight, with every gotcha called out.

## Scaffold vs. Framework

- `packages/create-supa-app/templates/` — copied verbatim (with `{{VAR}}`
  substitution) into every new app. Changes here ship to **all future apps**.
- `packages/claude/templates/` — the Claude Code config (`CLAUDE.md`, commands,
  hooks) that `@supa-media/claude sync` writes into a scaffolded app. The scaffold's
  `CLAUDE.md` is generated from `packages/claude/templates/CLAUDE.md`, **not** from
  `create-supa-app/templates/`.
- When you change a documented behavior, update the matching doc in the same change.

## Working Style

- **Commit frequently**, atomic commits, descriptive messages.
- **Never push directly to `main`** — branch + PR. PRs need passing CI.
- Prefer readable over clever; remove dead code rather than deprecating it; don't
  over-engineer beyond what's asked.
