# @supa-media/scripts

## 1.1.0

### Minor Changes

- 4ae8135: Add `supa-sync-1password-to-github` CI script and a reusable `sync-secrets.yml`
  (`workflow_call`) workflow, unifying the near-duplicate
  `sync-1password-to-github.sh` + `sync-secrets.yml` pair that Togather
  (`ee/scripts/sync-1password-to-github.sh`, vault `Togather`) and Fount
  (`scripts/sync-1password-to-github.sh`, vault `Studios`) each maintained
  separately. See `docs/SECRETS.md` for the 1Password -> GitHub -> Convex/EAS
  flow this implements.

  The two app scripts were genuine near-duplicates with a few real differences,
  resolved as follows:
  - **Vault name and secret allowlist are now parameters**, not hardcoded
    bash arrays. The allowlist is a JSON file (`--allowlist` / `SUPA_SECRETS_ALLOWLIST`)
    with `required` / `optional` arrays, an `alwaysSet` map (Togather's
    `AUTO_MERGE_ENABLED`/`AUTO_MERGE_METHOD` on/off-switch pattern, generalized —
    always written every sync, 1Password value or the given default, never
    skipped) and an `aliases` map (Togather's `IMAGE_CDN_URL` = `R2_PUBLIC_URL`
    pattern, generalized to any target/source key pair).
  - **Required vs. optional secrets now behave differently**, per Fount's
    (stricter, more correct) model: a missing `required` secret fails the sync
    (`missing_required` count, exit 1) instead of silently being skipped like
    Togather's script did for everything. Missing `optional` secrets are
    **pruned** (`gh secret delete`) from the GitHub environment — Fount's
    improvement over Togather's script, which left a stale value in GitHub
    forever once removed from 1Password. This matches `docs/SECRETS.md`'s
    "1Password is the single source of truth" model.
  - **Kept Togather's `gh secret set` retry-with-backoff** (`gh_secret_set_retry`,
    3 attempts) for the transient-502-on-environment-public-key-fetch failure
    mode — Fount's script didn't have it and both apps hit it in practice.
  - **Kept Fount's `OP_SERVICE_ACCOUNT_TOKEN`-as-auth-proof check** (`op account
list` fails for a non-interactive service-account session in CI, so the
    script also accepts the token env var as valid auth) and `set -euo pipefail`
    — Togather's script used the weaker `set -e` and only checked `op account
list`, which is unreliable in CI.
  - The "only re-sync when a secret changes" behavior described in
    `docs/SECRETS.md` (don't poll 1Password on every push — rate-limited) lives
    in the _caller's_ trigger, not this script: Togather's old workflow had a
    `push: paths:` trigger scoped to its allowlist script so a merge that adds a
    secret key re-syncs automatically, while Fount's was `workflow_dispatch`
    only. The new reusable `sync-secrets.yml` is `workflow_call`-only by design
    — each consumer app's thin wrapper workflow decides whether/how to trigger
    it (manual dispatch, and optionally a `push: paths:` on its own allowlist
    file), same as the CI workflow's `on:` triggers already work today.

  Usage:

  ```yaml
  jobs:
    sync-staging:
      uses: Supa-Media/supa-framework/.github/workflows/sync-secrets.yml@main
      with:
        vault: Togather
        allowlist-path: ee/scripts/secrets-allowlist.json
        environment: staging
      secrets: inherit
  ```

  ```
  npx @supa-media/scripts supa-sync-1password-to-github \
    --vault Togather --allowlist ee/scripts/secrets-allowlist.json --all
  ```

  Migrating Togather/Fount's existing `sync-1password-to-github.sh` +
  `sync-secrets.yml` onto this is a follow-up (not done here — this PR only
  adds the framework-side canonical version; the apps' own scripts/workflows
  are untouched). `docs/SECRETS.md` isn't updated to reference the new bin in
  this PR either — flagged as a follow-up.

## 1.0.0

### Major Changes

- f8bd26b: First stable release. The framework's packages are now published to GitHub
  Packages with changesets-managed versions and CHANGELOGs; consumers pin
  `^1.0.0` and update via `pnpm update @supa-media/*`.
