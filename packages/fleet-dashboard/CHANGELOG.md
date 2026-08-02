# @supa-media/fleet-dashboard

## 0.1.0

### Minor Changes

- 31f01a9: New workspace package: a read-only fleet dashboard.

  One phone-friendly page showing every repo in the fleet at once — active runs,
  open PRs, default-branch CI, and last deploy per project; open pull requests
  grouped by project then by initiative (the branch prefix); the gh-aw "gardener"
  maintenance workflows with their engine/model, schedule, last run, and
  most-recently-reported cost; and a "needs you" row for anything blocked on a
  human review.

  Data comes from the GitHub REST + GraphQL APIs only, called directly from the
  browser with a fine-grained PAT the user supplies at runtime and that is stored
  in `localStorage` — there is no backend and no secret in the build. The single
  write action is an ✎ deep link to GitHub's own web editor for a gardener's
  markdown source.

  The package is `private: true` (it is a deployable app, not a published
  library), so this changeset versions it and writes its changelog without
  publishing it to the registry. `sources/types.ts` documents the adapter seam
  where a Convex `@supa-media/dev-assistant` source plugs in for v2.

- 07131af: Fleet dashboard v2: the twice-a-day review ritual.

  v1 was a status board. v2 is the screen the day is run from, and everything else
  supports it. Ten views, in nav order: ☀️ Review (home), 📥 Inbox, ✦ Copilot,
  ◉ Now, ☰ Queue, one per app, 🐕 Watchdog, 🌱 Gardeners, 🔐 Secrets, ＋ New app.

  **☀️ Review** answers a morning in five bands: what shipped since your last
  review (merged PRs across the fleet, with evidence chips parsed from each PR
  body's `## Evidence` section and a production-vs-merge-time deploy state);
  decisions an agent made in your absence (`**[decider]**` marker comments, with
  Keep as the default and Overturn posting a reason and relabelling); what is
  genuinely parked (`agent:blocked`, with its `**[context-sheet]**` rendered
  inline); today's plan per app, approved in one batched GraphQL mutation; and
  questions batched out of parked context sheets, answered with one tap.

  **Everything the UI does is a label, a comment, an issue, or a workflow
  dispatch.** It never merges a PR, never edits a workflow, never pushes a commit.
  Gardener prompts and caps are now visible inline and editing them is a deep link
  to GitHub's own editor, because the markdown has to go through gh-aw's compile
  step to reach the `.lock.yml` Actions actually runs.

  Also new: a fleet-wide secrets matrix (rows are the union of every repo's
  allowlist keys, columns are repos, cells separate "allowlisted" from "a GitHub
  secret exists" and degrade to _unknown_ rather than _missing_ when the token
  lacks admin scope), a real ⌘K palette, `.fleet/initiatives.json` for initiative
  phases and archiving, and the ⚡ `agent:notify` toggle wherever an item appears.

  The label vocabulary (`agent:ready` / `in-progress` / `blocked` / `automerge` /
  `notify`, `plan:approved`, `inbox:proposed` / `raw`, `watchdog:report`, `init:*`,
  `size:*`), the three marker comments, the evidence section, and the initiatives
  schema are all documented in the README — they are the contract between this
  dashboard, the overnight orchestrator, the Telegram worker, and the watchdog.

  Two fixes carried in: `parseEngine` now finds gh-aw's **top-level** `model:` key,
  which every real gardener in the fleet uses and v1 missed (so the column that
  exists to make an expensive model obvious was showing only the engine id); and
  the GraphQL document no longer re-fetches merged PRs and labelled issues on each
  pagination round-trip.

  The token now needs **write** on issues (and on actions, to dispatch a secrets
  sync) — a real escalation from v1's read-only token, called out in the token gate
  and the README.
