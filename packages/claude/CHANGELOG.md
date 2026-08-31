# @supa-media/claude

## 1.0.2

### Patch Changes

- cc38f27: Every package now ships an MIT LICENSE file and a README inside its tarball.

  The repo declared `"license": "MIT"` in all 13 package manifests with no LICENSE
  file anywhere, so npm rendered an MIT badge over a tarball containing no grant.
  Each package now carries a copy of the root LICENSE (a copy, not a symlink — npm
  does not follow symlinks into a tarball) with `"LICENSE"` in its `files` array.

  12 of the 13 also had no README and would have published a blank npm page; they
  now document their real public surface, peer dependencies, and constraints.

  `@supa-media/claude` additionally changes what it scaffolds. Its
  `templates/settings.json` previously wrote
  `{"permissions": {"dangerouslySkipPermissions": true}}` into the consumer's
  `.claude/` — a package that disabled the agent's permission prompts on install.
  It now ships a conservative `permissions.allow` allowlist (routine reversible
  commands: pnpm dev/test/lint/typecheck/build, `npx convex dev|run|logs`,
  read-only git and gh, plus add/commit/checkout) and denies reads of `.env*`.
  `git push`, `git reset --hard`, `gh pr merge`, `convex deploy` and `eas` are
  deliberately left to prompt; widen the allowlist for your own repo.
  `templates/hooks.json` no longer registers a `Stop` hook pointing at a
  `ralph-logger.sh` that was never shipped, and is now an empty starting point.
  Existing `.claude/settings.json` and `.claude/hooks.json` files are untouched
  unless you run `supa-claude sync --force`.

## 1.0.1

### Patch Changes

- 15771cc: Sync Claude command templates with improvements from Togather live implementations:
  - **auto-worker**: Add emoji warnings/markers (⚠️/❌/✅) for better visual clarity; improve section formatting
  - **feature-validate**: Add test credentials section; improve environment setup documentation; add Watchman troubleshooting
  - **fix-ci**: Add Docker/workspace dependency failure patterns; expand regression test guidance; add 🤖 emoji to commits
  - **lock-up**: Add 🤖 emoji to commit messages and PR description; update verification checklist with ✅ markers
  - **review-cycle**: Add Phase 4.7 Onboarding Docs Sync Check (generic pattern for documentation-heavy projects); update safety rules to include docs sync
  - **ios-build**: No changes (identical between versions)
  - **isolate**: No changes (Togather-specific implementation, not portable)

## 1.0.0

### Major Changes

- f8bd26b: First stable release. The framework's packages are now published to GitHub
  Packages with changesets-managed versions and CHANGELOGs; consumers pin
  `^1.0.0` and update via `pnpm update @supa-media/*`.
