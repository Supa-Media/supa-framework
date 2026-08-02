# fleet-backend

The Supa Fleet dashboard's Convex backend. It exists to hold the two things
GitHub cannot, and it is scoped so tightly that "what it does not hold" is the
more useful half of this document.

## The rule

**GitHub remains the source of truth for work state.** Issues, labels, pull
requests, workflow runs, review requests, the ⚡ flag — all of it lives in
GitHub, and the dashboard reads it from the GitHub API and writes it back as
labels and comments. **None of it is mirrored here.** A mirror would give the
fleet two answers to "is this item ready?" and a background job whose whole
purpose was to make them agree.

This backend holds only what GitHub has nowhere to put.

## What it stores

**`reviewState`** — one row, the "since last reviewed" marker.

`{ lastReviewedAt, updatedAt, device, prefs }`. GitHub has no place for this: a
label saying "seen" would be a public write on every glance, and wrong the
moment you opened a second device. Cross-device conflicts resolve **last write
wins by `updatedAt`**, which is the *client's* clock — so an offline phone that
marked reviewed at 07:00 and syncs at 09:00 does not overwrite the laptop's real
08:00 mark. Ties keep the stored row, so a retry is not a change.

`prefs` is a flat string map with room for cross-device preferences that are
genuinely about the person. It is empty in v1. **An issue's ⚡ does not go here**
— ⚡ is the `agent:notify` GitHub label, the whole pipeline already agrees on it
there, and a mirror would be a second quietly-diverging opinion about one flag.

**`runEvents`** — append-only telemetry, one row per thing a fleet job saw while
running.

`{ source, repo, issueNumber?, kind, at, receivedAt, url?, dedupeKey?, payload? }`
where `source` is `overnight | watchdog | decider | gardener`. GitHub records
that a workflow run failed; it does not record that the watchdog woke at 03:12,
diagnosed a stall, and respawned the agent. Nothing updates or deletes a row.
Reads are windowed — 24 hours by default, 30 days maximum, 500 rows per page —
so a table that grows every night never becomes a query that scans forever.

That is the whole schema. There is no chat table and no copilot state: v1 is a
foundation for those, not an implementation of them.

## Trust model

One shared write secret, one read token, no accounts, no PII.

| | Held by | Grants |
|---|---|---|
| `FLEET_BACKEND_SECRET` | CI (overnight, watchdog, decider, gardeners) | **Telemetry ingest only.** |
| `FLEET_READ_TOKEN` | the human's browser | **Reads, plus writes to the review marker.** |

The split is the point. A leaked backend secret can write junk telemetry; it
cannot read your review state or anything else. A read token recovered from a
laptop cannot forge a watchdog intervention. Neither is a login: v1 has one
human, and holding the read token *is* being that user (`userKey` is the string
sentinel `"owner"`, so the day a second person gets a token they get a row
rather than a migration).

**No Convex auth providers in v1**, and consequently **every Convex function in
this app is `internal`**. `convex/http.ts` is the only door and the only place a
credential is checked. A function exported as `query` would be a second door
with no lock on it, because a deployment URL is not a secret — it ships in the
dashboard's bundle.

**No PII.** Events are operational telemetry: repo slugs, issue numbers, run
kinds, and whatever small payload the job attached. The only free-text field a
human writes is `device` ("iPhone", "Mac"), capped at 64 characters. Nothing
here identifies a person because there is only one.

### How a writer signs

HMAC-SHA256 over `<timestamp>.<raw body>`, hex, in `x-fleet-signature`, with the
same unix-millisecond timestamp in `x-fleet-timestamp`. Requests more than five
minutes from the server's clock are refused.

This is the dev-assistant's callback pattern (`@supa-media/dev-assistant`'s
`pipeline/signature.ts`) with one deliberate addition. That pipeline signs the
body alone and needs no timestamp because its replay defence is *structural* —
its bug lifecycle is a monotonic state machine, so a replayed callback claims a
status the item already passed and is rejected as an illegal transition.
`runEvents` is an append-only log with no state machine to make a replay
illegal, so a captured POST would otherwise duplicate itself forever. The
timestamp is inside the signed string, so it cannot be edited to refresh a stale
capture. Within the window, supply a `dedupeKey` for at-most-once insertion.

The HMAC helpers are a local copy rather than an import, for the same reason
`pipeline/signature.ts` is itself a copy of `@supa-media/convex/webhooks`:
raw-TypeScript Convex packages in this framework do not depend on each other,
and pulling in a PR-contribution-pipeline package to reach fifteen lines of Web
Crypto would be reuse in name only.

## Routes

All under `/fleet/`, on the deployment's **HTTP actions** origin — the
`.convex.site` one, not `.convex.cloud`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/fleet/events` | HMAC | One event, or `{ events: [...] }` up to 100. Body ≤ 64 KB. `202` with `{ inserted, deduped }`. |
| `GET` | `/fleet/events` | Bearer | `?since=&repo=&source=&limit=`. `since` is clamped to 30 days, not refused. |
| `GET` | `/fleet/review` | Bearer | `{ state }` or `{ state: null }`. |
| `POST` | `/fleet/review` | Bearer | `{ lastReviewedAt, updatedAt?, device?, prefs? }` → `{ applied, state }`. |
| `GET` | `/fleet/health` | none | `{ ok: true }`. |

An unconfigured secret answers **503**, never 200 — a backend nobody configured
must not accept writes from anybody who guesses the empty string.

CORS is `Access-Control-Allow-Origin: *` on purpose. The dashboard is a static
page on another origin and there is no session cookie anywhere in this design:
every request carries its credential in a header the browser will not attach on
its own. With no ambient authority to steal, pinning an origin would look like a
control while enforcing nothing (curl ignores it) and would break every preview
deployment.

### Posting an event

```bash
BODY='{"source":"watchdog","repo":"Supa-Media/events-os","kind":"respawn","payload":{"respawns":2}}'
TS=$(date +%s000)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$FLEET_BACKEND_SECRET" -hex | awk '{print $2}')
curl -sS -X POST "$FLEET_BACKEND_URL/fleet/events" \
  -H "x-fleet-timestamp: $TS" -H "x-fleet-signature: $SIG" \
  -H 'Content-Type: application/json' --data "$BODY"
```

## Working on it

```bash
pnpm --filter @supa-media/fleet-backend dev        # convex dev, watching
pnpm --filter @supa-media/fleet-backend test       # convex-test, no deployment needed
pnpm --filter @supa-media/fleet-backend typecheck
```

`convex/_generated/` is **committed** so CI can type-check without a Convex
login or a deployment. Regenerate it with `npx convex codegen` after changing
the schema or adding a function.

Deployment, and the two environment variables, are in [DEPLOY.md](./DEPLOY.md).
Neither value is ever committed, and neither belongs in `fleet.config.ts` — the
dashboard's URL setting is public, its token is entered in the gate.
