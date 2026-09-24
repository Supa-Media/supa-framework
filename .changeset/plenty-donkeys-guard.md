---
"@supa-media/scripts": minor
"@supa-media/claude": patch
---

Add `supa-architecture-check`, a zero-dependency file-size / architecture
guard CLI: enforces line-count thresholds on git-tracked files via
`architecture.config.json`, with a `generated` exemption for machine-written
files and a one-way `baseline` ratchet for legacy debt. Wired into the
reusable `ci.yml` workflow (`architecture-check` input) and the
`create-supa-app` scaffold, which now opts every new app in. The scaffolded
`CLAUDE.md` (`@supa-media/claude`) documents the policy for agents.
