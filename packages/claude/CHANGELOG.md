# @supa-media/claude

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
