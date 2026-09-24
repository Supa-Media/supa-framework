# @supa-media/scripts

**Six CI and release binaries for Supa apps:** moving secrets from 1Password to
GitHub and on to Convex, generating OTA version strings, bumping app versions,
and guarding file size / architecture. No library surface — these are
executables you call from a workflow or a terminal.

## Install

```bash
pnpm add -D @supa-media/scripts
```

Or run one-off in CI without adding a dependency, which is how the framework's own
reusable workflow does it:

```bash
npx --yes --package=@supa-media/scripts supa-sync-1password-to-github --vault Acme --allowlist ee/secrets-allowlist.json --environment staging
```

The secret binaries implement the framework's canonical flow — **1Password is the
source of truth, GitHub environment secrets are a required buffer because
1Password rate-limits reads, and only the deploy step pushes the last hop into
Convex/EAS.** Read [`docs/SECRETS.md`](https://github.com/Supa-Media/supa-framework/blob/main/docs/SECRETS.md) for why the middle
hop is not optional; it isn't restated here.

---

## `supa-sync-1password-to-github`

*Runs in CI, on demand — or locally with an admin `gh` token.*

Reads `op://<vault>/<KEY>/<environment>` for every allowlisted key and writes the
matching **GitHub Environment secret** (`staging` / `production`).

```
--vault NAME          1Password vault           (or OP_VAULT)
--allowlist PATH      allowlist JSON file       (or SUPA_SECRETS_ALLOWLIST)
--environment NAME    staging | production      (-e)
--all                 both environments
--dry-run             print the plan, change nothing
```

Requires `op`, `gh`, and `node` on PATH; an authenticated `op` session or
`OP_SERVICE_ACCOUNT_TOKEN`; and `gh` authenticated with **repo admin scope** —
the default Actions `GITHUB_TOKEN` cannot write secrets. The target repo comes
from `gh repo view`. Retries: `SUPA_RETRY_MAX_ATTEMPTS` (3),
`SUPA_RETRY_BACKOFF_SECONDS` (3).

The allowlist is a JSON object — **a key not listed is never synced**:

| Field | Behavior |
| --- | --- |
| `required` | Synced from 1Password. A missing value **fails the sync**. |
| `optional` | Synced when present; **pruned** (`gh secret delete`) when confirmed absent, so a deploy can't read a value you already removed from 1Password. |
| `alwaysSet` | `{KEY: default}` — written on every sync, the 1Password value if present, else the default. For on/off switches where "missing" must mean the safe default. |
| `aliases` | `{TARGET: SOURCE}` — writes another key's resolved value under a second name. Pruned when the source is absent. |

Execution is **two-phase and all-or-nothing per environment**: phase 1 reads and
classifies every key before a single GitHub API call; phase 2 only runs if phase 1
came back clean, setting values first and pruning second.

> **⚠️ `op read` exits 1 identically for "this item does not exist" and "I could
> not check."** Treating the second as the first would `gh secret delete` a live
> production secret on a network blip. So a key is prune-eligible only when op's
> stderr matches its own not-found phrasing; every other failure — auth, rate
> limit, a mistyped vault — aborts the run after retries, with zero writes and
> zero deletes. If you see the ABORTED summary, nothing changed.

The framework ships a reusable workflow around this; a consumer repo calls it from
a thin `workflow_dispatch` wrapper:

```yaml
jobs:
  sync:
    uses: Supa-Media/supa-framework/.github/workflows/sync-secrets.yml@v1
    with:
      vault: Acme
      allowlist-path: ee/secrets-allowlist.json
      environment: ${{ inputs.environment || 'both' }}
      dry-run: ${{ inputs.dry-run || false }}
    secrets:
      OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
      GH_ADMIN_TOKEN: ${{ secrets.GH_ADMIN_TOKEN }}
```

It is `workflow_call`-only by design — the caller decides when it runs (manual
dispatch, plus optionally a `push: paths:` scoped to its own allowlist file).
Never on every push.

## `supa-sync-secrets`

*Runs in a CI deploy step, or locally.*

Pushes secrets into a **Convex deployment** with `npx convex env set`.

```
supa-sync-secrets --staging
supa-sync-secrets --production JWT_SECRET RESEND_API_KEY
supa-sync-secrets --staging --vault "My Vault" --config ./supa.config.json
```

Keys come from the command line, else the `secrets` array in `supa.config.json`
(`--config` / `SUPA_CONFIG`, default `./supa.config.json`). Each key is read from
`op://<vault>/<KEY>/credential` — falling back to the same-named shell
environment variable if that read fails. Missing keys are skipped with a warning;
any `convex env set` failure exits 1. `CONVEX_DEPLOY_KEY` authenticates in CI;
without it the logged-in Convex session is used.

> **⚠️ `--staging` / `--production` is required but does not choose the
> deployment.** It only labels the output. The target is whatever `npx convex`
> resolves in that working directory — set `CONVEX_DEPLOY_KEY` (or the deployment
> env) to point at the right one. Note also that this reads the `credential`
> field of a 1Password item, not the per-environment `staging`/`production`
> fields that `supa-sync-1password-to-github` uses.

## `supa-generate-ota-version`

*Runs in CI, in the OTA deploy job.*

Prints an Expo OTA version string, `RUNTIME_VERSION.MMDDYY.HHMM` (local time), to
stdout — nothing else, so CI can capture it:

```bash
OTA_VERSION=$(npx supa-generate-ota-version --app-json ./apps/mobile/app.json)
# 1.0.21.040826.1432
```

Runtime version resolution, first hit wins: `--runtime-version`, then
`supa.config.json`'s `runtimeVersion` (`--config`), then `app.json`'s
`expo.runtimeVersion`, then `expo.version` (`--app-json`; searched at `./`,
`./apps/mobile/`, and one level up). Exits 1 if none resolve.

## `supa-setup-secrets`

*Local only — it prompts.*

Interactive first-run setup for a local checkout. Reads the variable names out of
`.env.example` (`--env-example`), pulls each from `op://<vault>/<KEY>/credential`,
prompts you for the ones 1Password doesn't have, and writes `.env.local`
(`--output`/`-o`); skipped keys are left as comments. It then checks that the
Convex URL, Twilio credentials, and Resend API key actually work, unless you pass
`--skip-validation`. The vault comes from `--vault`/`OP_VAULT`, else
`supa.config.json` (`--config`), else a prompt.

It prompts before overwriting an existing output file, so don't run it
unattended.

## `supa-bump-version`

*Runs locally, or in a release workflow.*

Bumps the app version in `app.json` and, when present, `app.config.js`.

```
supa-bump-version --patch | --minor | --major | --version 2.0.0
                  [--dry-run] [--app-json PATH] [--app-config PATH]
```

In `app.json` it sets `expo.version`, `expo.ios.buildNumber` (string), and
`expo.android.versionCode` (number) — both build numbers derived from the current
one plus 1. In `app.config.js` it rewrites the `version:`, `runtimeVersion:`, and
`otaVersion: process.env.OTA_VERSION || "…"` string literals by regex. A new
version that isn't strictly greater than the current one is refused.

> **⚠️ It rewrites `runtimeVersion` in lockstep with `version`.** If your app
> pins `runtimeVersion` to the shipped native binary so OTA updates stay
> compatible, that rewrite silently orphans every installed build. Check the
> `app.config.js` diff, or bump `app.json` only.

## `supa-architecture-check`

*Runs in CI (via the reusable `ci.yml` workflow's `architecture-check` input),
or locally.*

A zero-dependency file-size / architecture guard. It scans every git-tracked
file, counts physical lines, and enforces the thresholds in
`architecture.config.json` at the repo root (`--config` to override).

```json
{
  "thresholds": { "warn": 500, "review": 700, "max": 1000 },
  "exclude": ["**/*.png"],
  "generated": [
    { "path": "pnpm-lock.yaml", "reason": "Package manager lockfile.", "command": "pnpm install" }
  ],
  "reviewed": { "path/to/file.ts": "Why this cohesive module earns 700-1000 lines" },
  "baseline": { "apps/x/big.ts": 14515 }
}
```

| Field | Meaning |
| --- | --- |
| `thresholds` | `warn` — informational; `review` — needs a `reviewed` reason; `max` — needs a `baseline` entry to exceed it. |
| `exclude` | Extra glob patterns (`**`, `*`, `?` — no other syntax) skipped entirely. Binary files (a NUL byte in the first 8 KB) are always skipped. |
| `generated` | Exact paths (no globs) fully exempt from every size/line-length check — lockfiles, bundles, anything machine-written. Each entry needs a non-empty `reason` and `command`. |
| `reviewed` | A file between `review` and... well, above `review` at all, with a stated reason it's one cohesive thing. Stale once the file drops back to `<= review`. |
| `baseline` | The one-way ratchet for legacy debt: a file over `max` may exist only if `baseline[path]` is >= its current line count. It can only be lowered (never removed by inflating the number) and, under `--base`, it can never gain a new key — see below. |

Line counts match `wc -l` (the count of `\n` bytes) for a file that ends in a
newline; a file whose last line has no trailing newline still counts that
line — a deliberate, documented departure from raw `wc -l`, chosen because a
missing trailing newline is exactly the kind of hand-edited file this tool
exists to flag, not one to under-count.

```
supa-architecture-check                      # check the working tree
supa-architecture-check --base origin/main   # also enforce the ratchet: no new
                                              # baseline entries, no inflated
                                              # baseline numbers, no raised
                                              # thresholds, no new `generated`
                                              # entry or `exclude` pattern
                                              # (without --allow-generated-change),
                                              # and any file new-or-grown past
                                              # `review` needs a `reviewed` entry.
                                              # When the base ref has no config
                                              # yet (the adopting change), only
                                              # the local rules run.
supa-architecture-check --report [--json]    # line-count stats (count, mean,
                                              # median, p95, max) per category
                                              # (tests / docs / source) and the
                                              # top 20 largest handwritten files
supa-architecture-check --init               # write a starter config: default
                                              # thresholds, present lockfiles as
                                              # `generated`, and a `baseline`
                                              # entry for every file already
                                              # over `max` — for adopting the
                                              # tool in an existing repo
supa-architecture-check --allow-generated-change --base origin/main
                                              # the one escape hatch, and only
                                              # for a deliberate PR that adds a
                                              # `generated` entry or `exclude`
                                              # pattern and states why
                                              # — never pass this in CI
```

`--json` (with either a normal run or `--report`) prints machine-readable
output. In GitHub Actions (`GITHUB_ACTIONS=true`) findings also print as
`::error file=…::` / `::warning file=…::` annotations.

A `--base <ref>` run reads `architecture.config.json` and each flagged file's
line count *as they were at that ref* (`git show`), so it can tell new debt
from debt you already own. If the ref has no config at all, base is treated as
an empty one. This is what the framework's own reusable `ci.yml` runs on pull
requests (`--base origin/${{ github.base_ref }}`) and what it runs plain on
`push` (no ratchet to compare against, just the current rules).

## Tests

`__tests__/sync-1password-to-github.test.js` (`node --test`) drives the
1Password → GitHub sync end to end against stub `op` and `gh` binaries, covering
the paths that are dangerous to get wrong: zero writes on a persistent read
failure, pruning a definitively-absent optional secret, aborting on a missing
required secret, rejecting a malformed allowlist before touching either CLI, and
recovering from a transient failure.

`__tests__/architecture-check.test.js` (`node --test`) drives
`supa-architecture-check` end to end against real temp git repos, covering the
threshold, baseline-ratchet, `--base`, `generated`, `reviewed`, binary-skipping
and `--init` behavior documented above.

The three other binaries (`supa-sync-secrets`, `supa-generate-ota-version`,
`supa-setup-secrets`) have no automated tests.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework. MIT.
