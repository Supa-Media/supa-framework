# @supa-media/fleet-dashboard

One page for a solo founder running several repos with heavy agent automation.

The ritual is the product: **look twice a day, be bothered never.** ☀️ Review is
home and everything else supports it. Between reviews only ⚡-flagged items and
true blockers reach Telegram; everything else waits on that screen.

| View            | Question it answers                                                     |
| --------------- | ----------------------------------------------------------------------- |
| ☀️ **Review**   | What shipped, what was decided for me, what is stuck, what am I approving? |
| 📥 Inbox        | What arrived from outside the pipeline, and is it worth doing?           |
| ✦ Copilot       | (stub) the ⌘K palette — file, dump, jump                                 |
| ◉ Now           | What is an agent holding right now?                                      |
| ☰ Queue         | What did I approve, and what will merge itself?                          |
| Apps            | What initiatives exist per repo, in what phase, on what environments?    |
| 🐕 Watchdog     | What did the watchdog do instead of waking me?                           |
| 🌱 Gardeners    | Are the maintenance workflows alive, on what engine, at what cost and cap? |
| 🔐 Secrets      | Which key is allowlisted where, and does the GitHub secret exist?        |
| ＋ New app      | What does standing up a new app actually take?                           |

There is no backend. Everything is the GitHub REST + GraphQL API, called
directly from the browser with a fine-grained PAT you supply at runtime.

## Running it

```bash
pnpm --filter @supa-media/fleet-dashboard dev      # http://localhost:5173
pnpm --filter @supa-media/fleet-dashboard build    # static output in dist/
pnpm --filter @supa-media/fleet-dashboard test     # typecheck + node --test
```

On first load the page asks for a GitHub token. Create a **fine-grained
personal access token** scoped to just the fleet repos:

| Permission                    | Why                                                        |
| ----------------------------- | ---------------------------------------------------------- |
| `Issues: Read and write`      | labels, comments, filing dumps — every review control       |
| `Pull requests: Read`         | shipped list, open work, review state                       |
| `Actions: Read and write`     | run history; **write** only to dispatch a secrets sync      |
| `Contents: Read`              | gardener sources, allowlists, initiative manifests          |
| `Metadata: Read`              | mandatory for every fine-grained token                      |
| `Secrets: Read` *(optional)*  | secret **names** for the matrix; without it the matrix says "allowlist only" |

> **v1 → v2 is a real escalation.** v1's token was read-only. v2's can relabel
> and comment on every repo in the fleet, and dispatch the secrets sync. Give it
> the shortest expiry you can live with and keep Cloudflare Access in front.

The token lives in `localStorage` and is sent only to `api.github.com` — there
is no backend, nothing is bundled into the build, and nothing is committed.
"Sign out" clears the token **and** the ETag response cache, which holds full
REST bodies including private workflow file contents. Signing in clears it too,
so a token swap never inherits the previous identity's cached data. A
`Content-Security-Policy` meta tag pins `connect-src` to `api.github.com`;
`public/_headers` carries the same policy as a real header for Cloudflare Pages
plus `frame-ancestors` — keep the two in sync.

## Label conventions

The dashboard holds no state of its own beyond one "last reviewed" timestamp.
Everything it shows and everything it changes is a label, a comment, or a
workflow dispatch — so these strings are the contract between the dashboard, the
overnight orchestrator, the Telegram worker, and the watchdog. They are declared
once in [`src/lib/labels.ts`](src/lib/labels.ts); nothing else may spell them.

```
inbox:raw ──(extraction)──► inbox:proposed ──(you keep)──► agent:ready
                                  └──(you reject)──► closed with a reason

agent:ready ──(you approve the plan)──► + plan:approved
            ──(an agent picks it up)──► agent:in-progress
            ──(the watchdog parks it)─► agent:blocked
```

| Label                | Meaning                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `agent:ready`        | Queued work an agent may pick up. Shows in **today's plan**.          |
| `agent:in-progress`  | An agent is on it. Drives **◉ Now**.                                  |
| `agent:blocked`      | Parked — three respawns burned, or a human-only blocker.              |
| `agent:automerge`    | The item's PR may merge itself once green. Absence ⇒ *your merge*.    |
| `agent:notify`       | ⚡ — Telegram pings you at each milestone instead of batching.        |
| `plan:approved`      | You approved it in a review. Drives **☰ Queue**.                      |
| `inbox:proposed`     | An extracted item awaiting keep/reject.                               |
| `inbox:raw`          | A dump awaiting extraction.                                           |
| `watchdog:report`    | A watchdog intervention report. Drives **🐕 Watchdog**.               |
| `init:<name>`        | The initiative this item belongs to. An item may carry several.       |
| `size:<S\|M\|L\|XL>` | T-shirt size, shown as a pill in the queue.                           |

Labels must **exist in the repo** before the dashboard can apply them — it
refuses to create one rather than let a typo'd convention spread across the
fleet one approval at a time.

### Marker comments

Agents cannot call the dashboard; there is no backend to call. They write GitHub
comments, and a comment earns a place on the review screen by opening with a
**marker**: a bolded bracketed word at the start of a line. Parser and rules in
[`src/lib/markers.ts`](src/lib/markers.ts).

```markdown
**[decider]** Fount size buckets → matched Togather's (1–50/51–200/200+)
reasoning: cross-app consistency, migration-free
confidence: high
```

```markdown
**[context-sheet]**
tried: four shapes of auth header against the sandbox key
failed: 403 every time, identical body
remaining: mint a production-scoped key — human-only

**[question]** Offline retry: dedupe by client id or server timestamp?
options: client id | server timestamp
```

| Marker           | Panel                                | Notes                                                            |
| ---------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `[decider]`      | Decisions made in your absence       | Only comments newer than your last review. Keep is the default; **Overturn** posts `@overturn: <reason>` and relabels `agent:ready`. |
| `[context-sheet]`| Parked — needs you                   | Rendered inline. Newest sheet wins; the issue body counts too.     |
| `[question]`     | Questions batched                    | Read from parked issues only. `options:` is pipe-separated, max 6, and becomes the answer buttons. |

Field lines are `key: value`, key lowercase and **one word** — a key pattern
allowing spaces would read `see https://example.com/…` as a field and delete the
sentence from the body.

A marker must **open a line**. A review comment *quoting* the convention
("we should use `**[decider]**` for this") therefore does not file itself as a
decision you have to keep or overturn.

### PR evidence

The overnight orchestrator ends every PR body with an `## Evidence` section. The
review screen renders it as chips, so five overnight merges can be accepted or
challenged in a glance. One bullet, one chip. Parser in
[`src/lib/evidence.ts`](src/lib/evidence.ts).

```markdown
## Evidence

- ![thread view](https://…/shot.png)
- tests: 41 passing, 2 new
- [staging deploy](https://github.com/…/runs/123)
- manual: replied to a hidden thread on device
```

Everything after the heading and before the next heading of the same or higher
level is evidence. HTML comments are stripped first, so a PR template that ships
the heading commented out does not make every PR show its own instructions as
proof. A PR with no section says **no evidence** rather than nothing.

### `.fleet/initiatives.json` (optional)

Initiatives are always *discovered* — from `init:*` labels on open issues and
from branch prefixes on open PRs. What discovery cannot supply is the two things
a human writes down: what **phase** the work is in, and that it is **archived**.
Hence an optional file, in the repo, changed by a normal commit. Schema in
[`src/lib/initiativesFile.ts`](src/lib/initiativesFile.ts).

```json
{
  "initiatives": [
    {
      "name": "giving",
      "phase": "hardening",
      "spec": "docs/plans/giving.md",
      "archived": false
    }
  ]
}
```

- `name` (required) — must match the `init:<name>` label.
- `phase` — one of `idea`, `building`, `launched`, `hardening`, `quiet`, `done`.
  Anything else is `null` (no chip) and reported as a problem, never coerced.
- `spec` — repo-relative path, linked from the card.
- `archived` — strictly `true`; `"no"` and `1` do not archive an initiative.

A bare array is accepted too. Parsing is total: a malformed file yields the
readable entries plus a list of problems shown above the cards. The **＋
initiative** and **archive / edit** buttons deep-link to GitHub's editor for this
file, pre-filled when it does not exist yet.

## Configuration

`src/fleet.config.ts` holds the repo list and, per repo: the deploy-workflow
*filenames*, which one counts as **production**, the secrets allowlist path, and
the sync workflow to dispatch. Adding a project is one entry in that array. It
also holds the Telegram bot URL, the watchdog ladder, and the New-app links —
all static content, because they are decisions rather than observable data.

Gardeners are discovered, not configured: any
`.github/workflows/gardener-*.lock.yml` (a compiled [gh-aw][gh-aw] workflow) is
picked up automatically, along with its `.md` source for engine, model, caps, and
prompt, and its cron for the schedule.

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
2. Add a policy of `Allow` / `Emails` limited to your own address.
3. Confirm an incognito window is challenged before the page loads.

Access is what stops a stranger who finds the URL from reaching a page where a
token may already be stored — and in v2 that token can write. Treat it as
required, not optional.

Because the repo's `release.yml` runs `turbo run build` across every workspace
package on push to `main`, this package's build must never need a secret or a
network call — and it doesn't.

## Architecture

```
fleet.config.ts        which repos, what counts as a deploy, static policy
sources/types.ts       the FleetSource + FleetWriter contracts  ← next source plugs in here
sources/github/        the only implementation (REST + GraphQL)
  client.ts              ETag-cached reads, cache-invalidating writes
  queries.ts             the aliased fleet document + the batched label mutation
  githubSource.ts        reads
  writer.ts              the four write verbs
lib/                   pure logic, unit-tested: evidence, markers, select,
                       labels, allowlist, initiativesFile, review, cron, cost,
                       engine, initiative, prState, time
components/            shell, nav, palette, shared primitives
views/                 one file per nav destination; presentational + actions
```

**What the UI may do.** Four verbs: add/remove a label, post a comment, file an
issue, dispatch a workflow. It never merges a PR, never edits a workflow, never
pushes a commit. That is not an oversight — a label change and a comment are
visible in an issue's timeline forever, while a merge performed by a dashboard
is one nobody can attribute later. Editing a gardener is a deep link to GitHub's
own editor, because the prompt must go through gh-aw's compile step to reach the
`.lock.yml` that Actions actually runs.

**Rate limits.** One GraphQL call covers every open PR, every merge in the
review window, every labelled issue, and the cost issues across the whole fleet —
one aliased search node per repo, so each repo also reports an exact `issueCount`
and paginates on its own cursor. The rest is REST with `If-None-Match`
conditional requests, and a `304` costs no budget. There is no polling: the page
fetches once, and again after a write or a Refresh. Remaining budget is in the
top bar. A write **invalidates the whole read cache** — the cache is keyed by
path with no notion of what a write touched, so total invalidation is the only
safe kind. It costs one cold refresh.

**Caps.** Open PRs page to 5 × 100 per repo; merges cap at 50 per repo per
window; labelled issues cap at 100 across the fleet; issue comments at the last
20. The project card always shows the exact count from `issueCount`, never the
number of rows fetched, and a truncated list says so.

## Notes and limitations

- **Copilot is a stub and says so.** A brainstorm partner needs a model, which
  needs a backend, which this app does not have — and its CSP allows exactly one
  host. The ⌘K palette is the honest subset: file, dump, open Claude Code, jump.
- **The paste box files one `inbox:raw` issue, not N proposals.** Splitting a
  dump client-side would mean either a regex pretending to be comprehension or
  an LLM call the CSP forbids. One honest issue beats five confident wrong ones.
- **Automerge is read from the label only.** Deriving it from CODEOWNERS would
  mean parsing a CODEOWNERS file per repo and guessing which paths an unwritten
  change will touch. The label is a decision something already made.
- **The secrets matrix has no 1Password column with data in it.** Reading
  1Password needs a service account that does not exist yet; the column says
  "pending service account" rather than showing plausible ticks.
- **`Secrets: Read` is admin-scoped and usually refused.** A cell then shows
  `✓·` (allowlisted, existence unknown) — never `✗`. The "required key with no
  secret" banner fires only on a *confirmed* absence.
- **Staging is not computed.** Every repo deploys staging on merge, so a merged
  PR is on staging by definition. Only production is compared against the merge
  time, and `prod ?` means "no production run visible to this token", not
  "undeployed".
- **Costs are per-report, not month-to-date.** The gh-aw report is *weekly* and
  nothing here does month arithmetic. `—` means unknown, never `$0.00`. Cost
  parsing is still unproven against a real report — `lib/cost.ts` is
  shape-tolerant, and `test/cost.test.ts` pins both its header-bound and
  positional paths.
- **Caps are real, and read from the source.** gh-aw meters in AI Credits at
  1 credit = $0.01, so `max-ai-credits: 200` renders as `$2.00`. Undeclared caps
  render `none ✎`, never `$0.00`.
- **"Active runs" counts the last 100 runs.** A repo doing more than 100 runs
  between refreshes could under-count. Deploys are queried per workflow and CI
  with a `branch=` filter, so both of those are exact.
- **NEEDS YOU skips your own PRs.** GitHub reports `REVIEW_REQUIRED` for any PR
  under a rule requiring approvals, including ones you opened, and then forbids
  self-review — so those rows would be un-actionable. An explicit review request
  addressed to you still shows.

### Next

- **A Convex `dev-assistant` source.** `sources/types.ts` documents the contract
  and the merge rules (merge by `ProjectSnapshot.key`, never throw for a partial
  failure). It would add the work-in-flight that has no PR yet — the main thing
  the GitHub API cannot see.
- **The Telegram worker** that turns a voice note into `inbox:proposed` issues,
  and the **decider** that writes `**[decider]**` comments during your absent
  hours. Both are separate workstreams; this dashboard already renders their
  output.
- **Copilot with a model behind it**, which is the point at which a backend
  stops being optional.
