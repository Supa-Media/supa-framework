# @supa-media/fleet-dashboard

One phone-friendly page for a solo founder running several repos with heavy
agent automation. It answers four questions without opening four GitHub tabs:

| Panel           | Question it answers                                            |
| --------------- | -------------------------------------------------------------- |
| Project cards   | Is anything running, broken, or undeployed right now?           |
| **Active work** | What are the agents actually building, grouped by initiative?   |
| **Gardeners**   | Are the maintenance workflows alive, on what engine, at what cost? |
| **Needs you**   | What is blocked on a human?                                     |

Read-only, with exactly one write action: the ✎ button on a gardener row deep
links to GitHub's web editor for that workflow's markdown source, so changing a
cadence (or an engine) is a normal GitHub commit rather than a bespoke API call.

## Running it

```bash
pnpm --filter @supa-media/fleet-dashboard dev      # http://localhost:5173
pnpm --filter @supa-media/fleet-dashboard build    # static output in dist/
pnpm --filter @supa-media/fleet-dashboard test     # node --test over the pure logic
```

On first load the page asks for a GitHub token. Create a **fine-grained
personal access token** scoped to just the fleet repos with these *read* repository
permissions:

- **Contents: Read** — workflow files (cron + engine frontmatter)
- **Pull requests: Read** — active work and review state
- **Actions: Read** — workflow runs (CI, deploys, gardener runs)
- **Issues: Read** — the gardener cost report
- **Metadata: Read** — mandatory for every fine-grained token

Give it the shortest expiry you can live with. The token is stored in
`localStorage` and sent only to `api.github.com` — there is no backend, nothing
is bundled into the build, and nothing is committed. "Sign out" clears it.

## Configuration

`src/fleet.config.ts` holds the repo list and the deploy-workflow *filenames*
whose latest successful run counts as "last deploy". Adding a project is one
entry in that array.

Gardeners are discovered, not configured: any
`.github/workflows/gardener-*.lock.yml` (a compiled [gh-aw][gh-aw] workflow) is
picked up automatically, along with its `.md` source for the engine/model and
its cron for the schedule.

[gh-aw]: https://github.com/githubnext/gh-aw

## Deploying (Cloudflare Pages + Access)

The build is fully static, so any host works. Cloudflare Pages with **Cloudflare
Access** in front is the recommended setup: the dashboard has no server-side
auth of its own, and Access supplies it without the app knowing.

```bash
pnpm --filter @supa-media/fleet-dashboard build
npx wrangler pages deploy packages/fleet-dashboard/dist --project-name fleet-dashboard
```

Then, in the Cloudflare dashboard:

1. **Zero Trust → Access → Applications → Add** a self-hosted application for
   the Pages domain.
2. Add a policy of `Allow` / `Emails` limited to your own address (or a one-time
   PIN / GitHub identity provider).
3. Confirm an incognito window is challenged before the page loads.

The token still lives in the browser, so Access is what stops a stranger who
finds the URL from reaching a page where a token may already be stored. Treat
`Access` as required, not optional.

Because the repo's `release.yml` runs `turbo run build` across every workspace
package on push to `main`, this package's build must never need a secret or a
network call — and it doesn't.

## Architecture

```
fleet.config.ts        which repos, and what counts as a deploy
sources/types.ts       the FleetSource adapter contract  ← v2 plugs in here
sources/github/        the only v1 implementation (REST + GraphQL)
lib/                   pure logic, unit-tested: initiative, cron, cost, engine
components/            presentational only; no fetching
```

**Rate limits.** One GraphQL call covers every open PR and the cost issues
across the whole fleet; the rest is REST with `If-None-Match` conditional
requests, and a `304` costs no budget. There is no polling — the page fetches
once and then only when you press Refresh. Remaining budget is shown in the
header.

### v2 hooks

- **A Convex `dev-assistant` source.** `sources/types.ts` documents the contract
  and the merge rules (merge by `ProjectSnapshot.key`, never throw for a partial
  failure). A source that reads `@supa-media/dev-assistant`'s `devBugs` and
  contribution pipeline would add the work-in-flight that has no PR yet — the
  main thing the GitHub API cannot see.
- **Write actions.** v1 deliberately delegates its one mutation to GitHub's own
  editor. Real write actions (approve, re-run a failed job, pause a gardener)
  need a token with write scope and a confirmation step, which is a different
  security posture than "a read-only token behind Access" — hence v2.

## Notes and limitations

- **Cost parsing is speculative.** `lib/cost.ts` parses the gh-aw
  `[gardeners] weekly cost & activity report` issue. No repo in the fleet posts
  one yet, so the parser is shape-tolerant rather than schema-strict and every
  cost cell currently renders `—`. When a report appears, verify the column
  layout against `test/cost.test.ts` before trusting the numbers. `—` means
  "unknown", never "$0.00".
- **Cron and engine come from different files.** The compiled `.lock.yml` holds
  the real cron (gh-aw lets the source write a friendly string like
  `daily around 12:00 on weekdays` and compiles it down), while only the `.md`
  source holds the engine frontmatter. Both are fetched, both are ETag-cached.
- **"Active runs" counts the last 100 runs.** A repo doing more than 100 runs
  between refreshes could under-count. Deploys are queried per workflow, so they
  are exact.
