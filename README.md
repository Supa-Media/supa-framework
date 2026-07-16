# Supa Framework

Opinionated full-stack framework for building apps with **Convex** + **Expo** + **React Native**.

Spawn a new app in 2 minutes. Get auth, notifications, chat, payments, CI/CD, and native safety out of the box. Focus on your domain logic — Supa handles the rest.

## Quick Start

```bash
# Clone the framework and run the scaffolder locally
git clone https://github.com/Supa-Media/supa-framework.git
cd supa-framework
pnpm install
node packages/create-supa-app/src/index.js my-app
# Then follow the interactive prompts
cd my-app
pnpm install
pnpm setup:secrets
npx convex dev
pnpm dev
```

## Packages

Published to **GitHub Packages** (private registry — requires `GITHUB_TOKEN` with `read:packages`). See [PUBLISHING.md](docs/PUBLISHING.md) for setup.

| Package | Description |
|---------|-------------|
| [`@supa-media/core`](packages/core) | Runtime providers, hooks, navigation, keyboard handling |
| [`@supa-media/convex`](packages/convex) | Backend auth (OTP), schema helpers, notifications, payments |
| [`@supa-media/chat`](packages/chat) | Real-time messaging with pagination, offline caching |
| [`@supa-media/notifications`](packages/notifications) | Push notifications with deep linking |
| [`@supa-media/payments`](packages/payments) | Stripe integration with staging/production separation |
| [`@supa-media/metro`](packages/metro) | Metro config factory for pnpm monorepos |
| [`@supa-media/native-safety`](packages/native-safety) | Native dependency gating for safe OTA updates |
| [`@supa-media/linter`](packages/linter) | ESLint rules for Supa conventions |
| [`@supa-media/testing`](packages/testing) | Reusable test suites for Expo gotchas |
| [`@supa-media/dev`](packages/dev) | Development orchestrator (Convex + Expo) |
| [`@supa-media/scripts`](packages/scripts) | CI/deploy helper scripts |
| [`@supa-media/claude`](packages/claude) | Claude Code configuration templates |
| `create-supa-app` | Interactive CLI scaffolder (private, run locally via the framework repo) |

## Reusable GitHub Workflows

Consumer apps call these instead of writing their own CI/CD:

```yaml
jobs:
  ci:
    uses: Supa-Media/supa-framework/.github/workflows/ci.yml@v1
    with:
      node-version: "22"
      shared-package: "@myapp/shared"
    secrets: inherit
```

## Philosophy

- **Opinionated, not flexible** — sensible defaults with escape hatches
- **Copy real code, don't generate** — extracted from production apps
- **Enforce conventions** — linting and tests catch mistakes before CI
- **Updates propagate** — `pnpm update @supa-media/*` brings improvements to all consumers

## License

MIT
