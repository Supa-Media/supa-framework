# Secrets (canonical flow for all Supa apps)

**1Password is the single source of truth.** Secrets flow in **one direction**, and
each hop only happens when a value actually changes:

```
1Password  ── source of truth
   │
   │  sync ONLY when a secret changes
   │  (1Password rate-limits reads, so CI must NOT read it at runtime)
   ▼
GitHub Actions secrets  ── per environment (production / staging GitHub Environments)
   │
   │  read by the deploy workflows on each deploy
   ▼
Server env  ── Convex deployment env vars, EAS / Expo build env
```

## Why this shape

- **1Password has a read rate limit.** Workflows that run on every push can't pull
  from it live without getting throttled. So we copy each secret into GitHub
  Actions secrets **once**, and re-sync **only when the value changes** in 1Password.
- GitHub secrets are scoped to GitHub **Environments** (`production`, `staging`), so
  the right value reaches the right deploy.
- The deploy workflows push secrets the last hop to the server (Convex via
  `convex env set` / its dashboard, EAS via `EXPO_TOKEN`, public `EXPO_PUBLIC_*`
  vars at build time).

## 1Password vault layout (same for every app)

- **One vault per app** (e.g. `Events`, `Togather`).
- **One item per secret**, as a **Secure Note**, named exactly like the env var it
  maps to (`RESEND_API_KEY`, `JWT_PRIVATE_KEY`, `JWKS`, `OPENROUTER_API_KEY`,
  `EXPO_TOKEN`, `CONVEX_DEPLOY_KEY`, `EXPO_PUBLIC_CONVEX_URL`, `SITE_URL`,
  `AUTH_EMAIL_FROM`, `ASC_API_KEY_P8` / `ASC_KEY_ID` / `ASC_ISSUER_ID`, …).
- Each item has **three string fields: `dev`, `staging`, `production`.**
  - **Env-agnostic** secrets (one Apple account, one OpenRouter key, etc.) repeat
    the same value across all three fields.
  - **Env-specific** secrets (`EXPO_PUBLIC_CONVEX_URL`, `SITE_URL`, …) differ per
    field.

## Syncing (only when a secret changes)

After editing a secret in 1Password, sync that environment's field into GitHub —
do **not** sync on every push:

- A `Sync Secrets` GitHub workflow (`workflow_dispatch`, input: environment), or a
  local `sync-secrets` script.
- It authenticates with a 1Password **service-account token** (the single bootstrap
  secret, stored as the GitHub secret `OP_SERVICE_ACCOUNT_TOKEN`), reads
  `op://<Vault>/<NAME>/<env>` for each required secret, and writes the matching
  GitHub Actions secret into the corresponding GitHub Environment.

## Who reads what (never skip a hop)

| Consumer | Reads from | Never reads |
| --- | --- | --- |
| GitHub Actions / deploy workflows | GitHub secrets | 1Password (rate limit) |
| Convex (server) | deploy step → `convex env set` from GitHub secrets | 1Password directly |
| EAS / Expo builds | `EXPO_TOKEN` etc. from GitHub secrets | 1Password directly |
| Local dev | `op inject` from `.env.example` (`op://<Vault>/<NAME>/dev`) | — |

Bootstrap exception: the **`OP_SERVICE_ACCOUNT_TOKEN`** itself lives only in GitHub
(and locally), because it's what authorizes the OP→GitHub sync. Scope each
service-account token to the **one app vault** it needs, and prefer a
**read-only** token for syncing; use a separate read/write token only for editing
the vault.
