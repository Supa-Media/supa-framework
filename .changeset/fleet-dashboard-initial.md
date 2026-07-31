---
"@supa-media/fleet-dashboard": minor
---

New workspace package: a read-only fleet dashboard.

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
