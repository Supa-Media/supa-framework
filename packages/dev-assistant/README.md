# @supa-media/dev-assistant

An **"app improves itself"** control plane for Convex apps: an AI-driven
contribution pipeline where contributors describe a bug/feature, an AI drafts a
spec, a maintainer approves, and Claude Code Routines build → review → fix →
merge → deploy the change — with a monotonic status machine, a signed HMAC
Routine callback, per-run-mode callback policy, severity-capped policy
auto-merge, and a post-merge staging-verification loop.

Ported from Togather's `devAssistant` module (ADR-029). Raw TypeScript, no build
step — consumed by the Convex bundler, like `@supa-media/convex`.

## What's in the box

- **Schema** — `supaDevAssistantTables()` (`devBugs` + `devBugMessages`).
- **Module-level Convex functions** at `@supa-media/dev-assistant/functions/{bugs,
  actions,contributions,maintainers}` that you re-export from your own modules,
  plus `registerRoutes(http)` for the HTTP surface. Configured once via
  `setDevAssistantConfig(config)` (a module-level config holder). **Not** a Convex
  component, and **not** a factory — see [Why a config holder, not a factory](#why-a-config-holder-not-a-factory).
- **Pure pipeline core** (`@supa-media/dev-assistant/pipeline`) — the status
  machine, callback policy, auto-merge severity gate, HMAC verification, and
  GitHub REST helpers, all ctx-free and unit-tested.
- **`templates/ROUTINE-PROMPT.md`** — the three Routine prompts to paste into
  your Claude account, with `{{PLACEHOLDER}}` substitutions.

## Injection seams (the only app-specific parts)

Everything else generalizes. You provide:

| Seam | Config key | Togather |
| --- | --- | --- |
| **Auth** — token → userId | `authenticate(ctx, token)` | `requireAuth` |
| **Role gate** | `canUseDevAssistant(ctx, userId)` | `platformRoles` incl. `dev_maintainer` |
| **Staff gate** (review screen) | `isSuperAdmin(ctx, userId)` (defaults to the role gate) | staff/superuser |
| **Notifier** — push/chat side effects | `notifier.notify(ctx, event)` | push for dashboard items, chat bot message for chat items |
| **Media resolve** | `resolveMediaUrl(url)` | R2 path → public URL |
| **Attachment guard** | `assertValidAttachment(url)` | require `r2:` prefix |
| ↳ *default (unset)* | rejects anything that isn't an `r2:` path — same as Togather; **not** opt-out, only opt-in-to-more (pass your own function to also allow http(s) URLs) | — |
| **Image upload** (`/upload` route) | `uploadImage(ctx, args)` | store to R2 |
| **Repo / GitHub** | `repo: { owner, name, … }` | `togathernyc/togather` |
| **HMAC header** | `signatureHeader` (default `x-supa-signature`) | `x-togather-signature` |

## Mounting

### 1. Schema (`convex/schema.ts`)

```ts
import { defineSchema } from "convex/server";
import { supaAuthTables } from "@supa-media/convex/schema";
import { supaDevAssistantTables } from "@supa-media/dev-assistant/schema";

export default defineSchema({
  ...supaAuthTables, // provides `users`
  ...supaDevAssistantTables(),
  // your tables…
});
```

`devBugs` references only `users`. It also reads two **optional** `users` fields:
`githubUsername` (Co-authored-by attribution) and `autoMergeMaxSeverity` (the
per-user auto-merge cap) — add them to your users table when you adopt Phase 2/3.
If you also wire a chat-origination flow, pass your chat FKs through the factory
(`extraBugFields` / `extraBugIndexes`).

### 2. The config module (`convex/functions/devAssistant/config.ts`)

Call `setDevAssistantConfig(...)` ONCE, at module load. This module is imported
for its side effect by every re-export file (step 3) and by `http.ts` / `crons.ts`,
which guarantees the config is set before any function handler runs (handlers
read it lazily). The config shape is unchanged from prior versions.

```ts
// convex/functions/devAssistant/config.ts
import { setDevAssistantConfig } from "@supa-media/dev-assistant";
import { requireAuth } from "./auth"; // your token → userId

setDevAssistantConfig({
  functionsPath: "functions/devAssistant", // MUST match where you re-export
  authenticate: (ctx, token) => requireAuth(ctx, token),
  canUseDevAssistant: async (ctx, userId) => {
    const u = await ctx.db.get(userId);
    return !!u && (u.isStaff || u.isSuperuser || u.platformRoles?.includes("dev_maintainer"));
  },
  repo: {
    owner: "acme-inc",
    name: "acme",
    stagingDeployWorkflowNames: ["Deploy Convex", "Deploy Mobile Update"],
    productionDeployWorkflowFile: "deploy-to-production.yml",
  },
  areas: ["billing", "chat", "settings", "other"],
  notifier: myNotifier, // optional — default is a silent no-op
});
```

### 3. Re-export the functions

The consumer **must** re-export at exactly `${functionsPath}/{bugs,actions,
contributions,maintainers}` (the package builds internal function references from
`functionsPath`). Each re-export file:

1. imports `./config` **for its side effect** (so the config is set before any
   handler here runs), then
2. re-exports the package's **module-level function consts** from the matching
   subpath. These are genuine builder outputs, so they survive Convex's generated
   `api`/`internal` type inference with concrete visibility + args — **no cast**.

> **⚠️ This is the single biggest operational footgun of this package.**
> `functionsPath` is a bare string, not a typed reference into your generated
> `_generated/api` — `makeFunctionReference` does no existence check. A wrong
> `functionsPath`, or a re-export renamed/dropped later, passes `tsc` and
> `convex deploy` cleanly and then fails **silently at runtime**: every
> scheduled call this package makes internally (`READY_FOR_IMPL →
> dispatchBug`, `CODE_REVIEW → dispatchReview`, the callback applier, the
> auto-merge action, …) throws `"Could not find function"` — visible only in
> the Convex log, never surfaced to a user. **Run the smoke test in step 8
> after wiring this up, and again after any refactor of these files.**

> **⚠️ Forgetting the `import "./config"` side-effect import** in a re-export
> file means that file's functions run with no config set — the first handler
> throws a descriptive `setDevAssistantConfig(...)` error. Keep it at the top of
> every re-export file (and in `http.ts` / `crons.ts`).

```ts
// convex/functions/devAssistant/bugs.ts
import "./config"; // side-effect: sets config before any handler here runs
export {
  getThreadHistory, getBug, getBugByRoutineRunId, getOriginatorAttribution,
  listOpenPrBugs, markDispatched, markSpecDispatched, markReviewDispatched,
  markFixDispatched, setGithubIssue, recordDispatchError, addSystemThreadMessage,
  recordProductionDeployOutcome, recordMergeFromAppFailure, applyCallback,
  handleGithubPrClosed, handleWorkflowRunEvent, getBugForReview, rejectBug,
  markBugMerged, retryDispatch,
} from "@supa-media/dev-assistant/functions/bugs";
// (co-locate any of YOUR OWN concrete functions in this same module too — they
//  coexist with the re-exports on the generated api node.)

// convex/functions/devAssistant/actions.ts
import "./config";
export {
  dispatchBug, dispatchSpec, dispatchReview, dispatchFix, attemptAutoMerge,
  mergeFromApp, retryMergeAfterUpdate, dispatchProductionDeploy,
  reconcileMergedPrs, handleRoutineCallback,
} from "@supa-media/dev-assistant/functions/actions";

// convex/functions/devAssistant/contributions.ts
import "./config";
export {
  submit, approveSpec, startBuild, archive, unarchive, postMessage,
  confirmStaging, reportStagingIssue, mergeNow, promoteToProduction,
  getThread, myContributions, listAll, getContribution,
  getGithubUsername, setGithubUsername,
} from "@supa-media/dev-assistant/functions/contributions";

// convex/functions/devAssistant/maintainers.ts
import "./config";
export { getAutoMergeCapForUser } from "@supa-media/dev-assistant/functions/maintainers";
```

### 4. HTTP routes (`convex/http.ts`)

```ts
import { registerRoutes } from "@supa-media/dev-assistant";
import "./functions/devAssistant/config"; // side-effect: sets config first
registerRoutes(http); // /dev-assistant/callback, /upload, /github/webhook
```

### 5. Reconcile cron (`convex/crons.ts`, REQUIRED backstop — not optional)

`reconcileMergedPrs` is the **only** path that reflects (a) a maintainer
merging the PR by hand on GitHub, (b) a merge of an item above its auto-merge
severity cap, or (c) any merge when webhook delivery is missing or
mis-secreted. Skip this step and any of those three strands the row at
`READY_TO_MERGE` forever, and staging-deploy observation never correlates (no
`mergeCommitSha`). Use the exported helper — it builds the same
`functionsPath`-derived reference as the rest of the package, so it can't
drift from step 3's wiring:

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { registerDevAssistantCrons } from "@supa-media/dev-assistant";
import "./functions/devAssistant/config"; // side-effect: sets config first

const crons = cronJobs();
registerDevAssistantCrons(crons); // reads functionsPath from the holder; every 15 min
export default crons;
```

### 6. Env vars (identical names to Togather)

`CLAUDE_ROUTINES_TRIGGER_URL[_SPEC|_IMPL|_REVIEW]`,
`CLAUDE_ROUTINES_TOKEN[_SPEC|_IMPL|_REVIEW]`, `DEV_ASSISTANT_CALLBACK_SECRET`,
`CONVEX_SITE_URL`, `GH_MIRROR_TOKEN` (or legacy `GITHUB_MIRROR_TOKEN`),
`GH_WEBHOOK_SECRET` (falls back to the callback secret), `AUTO_MERGE_ENABLED`
(`"true"` to arm auto-merge), `AUTO_MERGE_METHOD` (default `squash`).

### 7. Create the three Routines

Paste `templates/ROUTINE-PROMPT.md` (after substituting the `{{PLACEHOLDER}}`s)
into your Claude account's Routine configuration. See that file for the
three-Routine vs. single-Routine setup and the least-privilege credential split.

### 8. Smoke test (strongly recommended)

Two checks catch the two ways this integration silently breaks — run both
after first wiring it up, and again after touching `functionsPath` or the
re-exports in step 3:

**a) `functionsPath` resolves** — a one-line `node:test`/`vitest` assertion
against your generated `internal` API, using the package's `assertMounted`:

```ts
// convex/functions/devAssistant/mount.test.ts
import { test } from "node:test";
import { assertMounted } from "@supa-media/dev-assistant";
import { internal } from "../../_generated/api";

test("dev-assistant functionsPath resolves against the generated API", () => {
  assertMounted(internal, "functions/devAssistant");
});
```

`validateMount(internal, functionsPath)` returns the list of missing
`module:function` paths instead of throwing, if you'd rather assert on that.

**b) The pipeline actually dispatches** — submit one contribution end-to-end
(`contributions.submit` → wait for the row to reach `IN_PROGRESS`) against a
real deployment with `CLAUDE_ROUTINES_*` configured. `assertMounted` only
proves the wiring *resolves*; it can't catch a misconfigured trigger URL/token
or a Routine that never calls back.

## Why a config holder, not a factory

Earlier versions shipped a `createDevAssistant(config)` **factory** that returned
the Convex functions. That is **fundamentally incompatible** with a
strict-typechecked consumer, and no amount of annotation fixes it.

Convex builds a consumer's typed API entirely by static inference:

```
ApiFromModules → FunctionReferenceFromExport → FilterApi<…, FunctionReference<any, "internal" | "public">>
```

`api` and `internal` are **visibility partitions** of that surface. A function
survives onto its partition (with concrete args) **only if its `typeof` is a
genuine builder output** — a `Registered{Query,Mutation,Action}<ConcreteVis,
ConcreteArgs, …>` produced directly by a `*Generic` builder at module scope.

When ~48 functions flow through a factory's single large **inferred** return
type, TypeScript **widens each function's phantom visibility parameter** from its
concrete `"internal"`/`"public"` literal to the whole `FunctionVisibility` union.
A `"public" | "internal"` visibility matches **neither** partition predicate, so
the function vanishes from **both** `api` and `internal`. This was proven
exhaustively (supa-framework PR #27): re-mapping/re-pinning the type at any layer
also fails, because `FunctionReferenceFromExport`'s `infer Visibility` yields the
constraint, not the literal, for anything but a real builder const.

The fix is structural: every function is a **module-level const** built directly
with the `*Generic` builders and reading its config lazily from a module-level
**config holder** (set once by your `config.ts` via `setDevAssistantConfig`). A
plain re-export of a genuine const survives the partition cleanly.

> **⚠️ Both the package and your app must resolve the SAME `convex` install.**
> The visibility literal only survives `infer Visibility` if the re-exported
> const's `RegisteredAction`/`RegisteredQuery`/`RegisteredMutation` is the *same*
> `convex/server` type your generated `api`/`internal` filter uses. If `convex`
> is **duplicated** in your `node_modules` (e.g. two peer-keyed copies from
> different `react` versions), the cross-package `infer Visibility` falls back to
> the widened `FunctionVisibility` union and every function drops from both
> partitions again — the exact factory symptom, now from a dependency dup. As a
> normal registry dependency, `convex` dedupes automatically; if you ever
> `file:`/`link:` this package for local dev, **pin `react` (and `react-dom`) to
> one version** so `convex` stays a single install.

## Status machine

The lifecycle is **monotonic** — a bug only moves forward (plus `REJECTED` from
any non-terminal state). Stale/reordered callbacks can't corrupt state, and each
status is reached at most once so idempotency keys stay unique.

```
DRAFT → IN_REVIEW → READY_FOR_IMPL → IN_PROGRESS → CODE_REVIEW → READY_TO_MERGE → MERGED
  │         │            │               │             │              │
  └─────────┴────────────┴───────────────┴─────────────┴──────────────┴──▶ REJECTED (human)

CODE_REVIEW ─▶ MERGED           legal forward skip (a maintainer merges on GitHub before the AI verdict)
MERGED ─▶ READY_FOR_IMPL        the ONE deliberate cycle: the staging-redo loop (human-triggered only)
```

| From | Allowed → | Driver |
| --- | --- | --- |
| `DRAFT` | `IN_REVIEW` | spec-mode callback delivers the spec |
| `IN_REVIEW` | `READY_FOR_IMPL` | `approveSpec` (auto for low risk) / `startBuild` |
| `READY_FOR_IMPL` | `IN_PROGRESS` | `dispatchBug` marks the implement run |
| `IN_PROGRESS` | `CODE_REVIEW` | implement callback with `prUrl` |
| `CODE_REVIEW` | `READY_TO_MERGE`, `MERGED` | review verdict `approved` promotes; GitHub merge |
| `READY_TO_MERGE` | `MERGED` | auto-merge / in-app merge / webhook |
| `MERGED` | `READY_FOR_IMPL` | `reportStagingIssue` (staging-redo) |
| any non-terminal | `REJECTED` | maintainer |

**`MERGED` is webhook/auto-merge only** — a routine-source callback can never
claim a merge (GitHub is ground truth). **Callbacks are held to a per-run-mode
policy** (`activeRunMode`): spec→`IN_REVIEW`; implement→`IN_PROGRESS`/
`CODE_REVIEW`; review→`CODE_REVIEW`+verdict; fix→`CODE_REVIEW` (verdict ignored).
Out-of-policy callbacks record `lastError` and persist nothing else.

The **review → fix → re-review** loop is budgeted by `maxFixRounds` (default 3).
**Policy auto-merge** (`attemptAutoMerge`) merges a `READY_TO_MERGE`,
review-approved PR only when `AUTO_MERGE_ENABLED === "true"` and the bug's
`riskLevel` is at or below the originator's `autoMergeMaxSeverity` cap
(`none < low < medium < high`; default `low`). Staging verification is **not** a
merge gate — it happens post-merge and gates the manual production deploy.
