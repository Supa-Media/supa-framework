# @supa-media/fleet-inbox-worker

Send a voice note to a Telegram bot. Get back a list of proposed work items,
already filed as GitHub issues in the right repo, each with a keep / reject /
edit button.

**Nothing executes.** Every issue this worker files carries `inbox:proposed`,
and no agent picks those up. Work becomes real only when you press ✅ and the
label flips to `agent:ready`. That is the entire safety model, and it is
deliberately boring.

```
Telegram ──▶ /telegram ──▶ Whisper (Workers AI) ──▶ Claude (extraction)
                                                          │
                       ┌──────────────────────────────────┘
                       ▼
              GitHub issues (inbox:proposed)
                       │
                       ▼
              reply with ✅ ❌ ✏️ per item
                       │
             ✅ → agent:ready    ❌ → closed + a line in learnings.md
```

## What it handles

| You send                  | It does                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| A voice note or audio     | Transcribes with `@cf/openai/whisper`, then extracts             |
| A video / video note      | Transcribes the container as-is (see the honest caveat below)    |
| Text, or a forward        | Extracts directly                                                |
| Media **with** a caption  | Transcript is the content, caption is appended as context        |
| `queue: fix the RSVP badge` | Files one item immediately — no model call, no cost            |

Extraction produces two things: **items** (new work — title, acceptance
criteria, app, initiative, size, and a verbatim source quote) and **plan edits**
(reprioritize / cancel / modify something that already exists). Items are routed
to the repo whose domain vocabulary they speak; anything ambiguous is filed as
`unassigned` rather than guessed into the wrong repo.

## Trust model

**Read this before deploying.** It is the load-bearing fact about this worker,
and it is not obvious from the code.

Issues filed here are created by the worker's PAT. On GitHub that makes their
`author_association` **`OWNER`** — and the fleet's overnight orchestrator uses
`author_association` as its trust gate. So an issue this worker files is not
merely a note: it is an **owner-authored work item that a downstream agent will
trust**, and that agent has more power than this worker does.

Stated plainly:

> **Anything that reaches this bot is work authorization, pending your ✅.**
> The single-chat allowlist is not just an anti-abuse gate — it is the reason
> the issues on the far end are safe for another agent to act on. If someone
> else can send to this bot, they can author trusted work items in your fleet.

Four things hold that line. Three are enforced in code; one is you.

| # | Control | Where |
| --- | --- | --- |
| 1 | **Single-chat, single-sender allowlist** — only `TELEGRAM_CHAT_ID` is answered, and only that same id may *send* or press a button, so the transcript is your own voice | `isAllowedChat` / `isAllowedSender`, `src/index.ts` |
| 2 | **Labels are never model-controlled** — `size:` is a validated enum and `init:` passes a `[^a-z0-9/]` filter that cannot emit a colon, so no transcript can label its own issue `agent:ready` | `issueLabels`, `src/issue.ts` |
| 3 | **Dictated spans are fenced** — criteria and the source quote are wrapped in `<!-- untrusted-transcript -->` markers, so an agent reading the issue can tell content from instruction; comment delimiters *inside* a span are escaped, so no span can close its own fence | `renderIssueBody`, `src/issue.ts` |
| 4 | **You press ✅** — and the summary shows each item's acceptance criteria, so you approve text you have actually seen rather than an 80-character title | `renderSummary`, `src/callback.ts` |

Control 2 is the one to protect in review: it is what makes "a human presses ✅"
a real gate rather than an advisory one. If a label ever needs to carry model
output, that is a design change, not a refactor.

### Forwarded messages are the exception

A forward is the one supported input where the transcript is **not your own
words** — somebody else's text going through the same pipeline and coming out as
an `OWNER`-authored issue. It stays supported (forwarding a bug report is
genuinely useful), but it is marked at every layer:

- The extraction prompt is told explicitly that it is third-party content, that
  nothing may be attributed to you that you didn't say, and that
  instruction-shaped text in it is reported content rather than direction to it.
- The filed issue body opens with a **"⚠️ Forwarded content"** banner.
- The Telegram summary flags the item — *"forwarded content — not your own
  words"* — before you press anything.

### What this does not protect against

- If someone gets your **bot token**, they can read messages sent to the bot.
- If someone gets the **webhook secret** and can reach the worker URL, they can
  forge updates that look like they came from your chat — the chat-id check
  reads the forged payload, not a signature over it. Rotate both if either
  leaks.
- **Pointing `TELEGRAM_CHAT_ID` at a group** no longer lets other members drive
  the bot, but it doesn't work either: messages and button presses are checked
  against the sender's user id as well as the chat, and in a group those differ
  from the chat id, so nothing anyone sends there is answered. Use a 1:1 chat —
  there the two ids are the same number, which is why this needs no extra
  secret. (A `channel_post` has no sender to check and stays chat-gated only.)

The blast radius for a secret-holder is bounded by the PATs and by the
`inbox:proposed` precondition on the keep path. They can file proposals, and
they can comment on or close issues in the four repos. They **cannot** promote
an arbitrary issue to `agent:ready`: that path refuses any issue not currently
carrying `inbox:proposed`, so it only ever promotes items this worker filed and
you haven't decided on yet. They cannot push, merge, or open a pull request.

## The video caveat

There is no ffmpeg in a Cloudflare Worker, so there is no way to demux a video's
audio track first. The worker sends the container bytes to Whisper and lets it
try. That works for the plain MP4 a phone records and not for much else — and
when it fails, the bot says so ("Workers AI couldn't get audio out of that video
— send it as a voice note, or type it") instead of returning an empty transcript
that looks identical to a voice note that recorded silence.

**Media is capped at 5MB**, which is the Worker's memory budget rather than
Telegram's 20MB download limit. Workers AI takes audio as a `number[]`, so every
byte becomes an array element; at 20MB the array alone approaches the isolate's
128MB ceiling, and an OOM would happen *after* the webhook has already returned
200 — killing the isolate and sending you nothing at all. That is the same
silent failure the video handling exists to avoid, so the cap is set where the
honest error can still be delivered. 5MB is several minutes of opus, so in
practice this only ever bites the video path.

## Setup

### 1. BotFather (3 steps)

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → name it → copy the
   token it gives you. That's `TELEGRAM_BOT_TOKEN`.
2. `/setprivacy` → select the bot → leave privacy **Enabled** and use the bot in
   a **1:1 chat**. A group does not work: the sender check compares `from.id`
   against `TELEGRAM_CHAT_ID`, and only in a 1:1 chat are those the same number.
3. Message your new bot once, then find your chat id:
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
   ```
   That number is `TELEGRAM_CHAT_ID` — the **only** chat this worker will ever
   answer.

### 2. Secrets

Six, all set with `wrangler secret put`. None of them appear in
`wrangler.jsonc`, and none are ever committed:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN       # from BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # you invent this: openssl rand -hex 32
npx wrangler secret put TELEGRAM_CHAT_ID         # your chat id, digits only
npx wrangler secret put ANTHROPIC_API_KEY        # extraction only

# One GitHub token per resource owner — see "The tokens" below for why.
npx wrangler secret put GH_TOKEN_TOGATHERNYC     # togathernyc/togather
npx wrangler secret put GH_TOKEN_SUPA_MEDIA      # Supa-Media/events-os, Supa-Media/supa-framework
npx wrangler secret put GH_TOKEN_SHYOH           # shyoh/fount-studios
```

The secret name is derived, not configured: `GH_TOKEN_` plus the owner
uppercased, with every non-alphanumeric character an underscore. Add a repo
under a fourth owner to `src/fleet.ts` and its secret name follows from the
slug.

A single `GH_TOKEN` is still read as the fallback for any owner without its own
— which is all a **classic** PAT needs, since one of those already spans every
owner your account can reach. Fine-grained tokens cannot do that, so prefer the
three above.

### 3. KV namespace

```bash
npx wrangler kv namespace create INBOX_KV
```

Paste the returned id into `kv_namespaces[0].id` in `wrangler.jsonc` (a namespace
id names a namespace, it doesn't grant access to one — it's safe to commit).

### 4. Register the webhook

After deploying, point Telegram at the worker. The `secret_token` here **must**
equal the `TELEGRAM_WEBHOOK_SECRET` you set above:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://fleet-inbox-worker.<your-subdomain>.workers.dev/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "channel_post", "callback_query"]
  }'
```

`channel_post` is listed because the worker handles it — a post to a channel the
bot administers goes down the same path as a message, and it is still subject to
the `TELEGRAM_CHAT_ID` check. Omitting it here would leave that branch
unreachable; drop it from both if you never want channel posts.

Check it took:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## The security model, honestly

This worker is **the one place in the fleet that holds power**. Everything else
reads. So the scope is as small as it can be while still doing the job:

**The tokens.** A GitHub **fine-grained personal access token** is scoped to
exactly one *resource owner*, and the fleet's four repos span three of them — so
there is no single fine-grained token that reaches them all, and the worker
holds one per owner, routing every request by the owner half of the repo slug:

| Secret | Resource owner | Repositories |
| --- | --- | --- |
| `GH_TOKEN_TOGATHERNYC` | `togathernyc` | `togathernyc/togather` |
| `GH_TOKEN_SUPA_MEDIA` | `Supa-Media` | `Supa-Media/events-os`, `Supa-Media/supa-framework` |
| `GH_TOKEN_SHYOH` | `shyoh` | `shyoh/fount-studios` |

Each with exactly two repository permissions:

- **Issues: Read and write** — file proposals, label, comment, close
- **Contents: Read** — read `.fleet/initiatives.json`, nothing more
- (Metadata: Read is mandatory on every fine-grained token)

None of them can push a commit, open a pull request, merge anything, or touch a
repo outside its list. Give them the shortest expiry you'll tolerate re-issuing.
Everything the tokens are used for lives in one file, `src/github.ts` — that's
deliberate, so "what can the inbox actually do to my repos" has a short answer.

An owner with no token configured is not silently skipped: the first request for
one of its repos fails with `No GitHub token for <owner> — set GH_TOKEN_<OWNER>`,
which arrives as a Telegram DM. A 404 from GitHub, which is what a wrongly-scoped
token would produce, would send you hunting the wrong problem.

**Who can talk to it.** Three gates, all before any work happens:

1. **Secret-token verification.** Telegram echoes
   `X-Telegram-Bot-Api-Secret-Token` on every delivery; a request without the
   matching value gets a 401 and nothing else. Compared byte-by-byte rather than
   with `===`.
2. **Single-chat allowlist.** Even a correctly-signed update from any chat other
   than `TELEGRAM_CHAT_ID` is dropped with a silent 200 and a log line that
   records only `chat_not_allowed` — no id, no message text.
3. **Single-sender allowlist.** The sender's user id (`from.id`, on the message
   and on the button press alike) must equal `TELEGRAM_CHAT_ID` too. In a 1:1
   chat the two ids are the same number, so this costs no extra secret; in a
   group it is what stops another member from approving work in your name.
   Dropped the same way, logged as `sender_not_allowed`.

**What this does *not* protect against.** See the "What this does not protect
against" list under Trust model above — bot token, webhook secret, and group
chats. On blast radius, be precise about what a secret-holder can reach through
forged `callback_query` updates:

| Capability | Reachable? |
| --- | --- |
| File proposals in the four repos | Yes |
| Comment on any issue in the four repos | Yes |
| Close any issue in the four repos | Yes |
| Seed `learnings.md` from **any** issue title in the four repos | Yes — a forged ❌ records the title of whatever issue it names, and that line is injected into every later extraction prompt |
| Remove `inbox:proposed` from / add `agent:ready` to an **arbitrary** issue | **No** — the keep path refuses any issue not currently carrying `inbox:proposed` |
| Push, merge, or open a pull request | No — not in any of the PATs' permissions |

`agent:ready` is the label the fleet acts on, so that row is the one that
matters. The precondition is in `handleCallback` (`src/index.ts`) and is
covered by tests; it is what keeps this table's last two rows honest.

The `learnings.md` row is the one write path that outlives the request. ❌ is
not gated on `inbox:proposed` (closing something already handled is harmless and
is what ❌ means), so a forged reject can name any issue number and put that
issue's title — or a title someone with write access to one of the four repos
chose — into the next thirty extraction prompts. It is bounded rather than
prevented: `formatRejectionLearning` collapses whitespace so a title cannot forge
extra lines or a fake `##` header, strips backticks and quotes so it cannot close
the quoting around it, and caps the span at 120 characters; the file itself is
30 lines, FIFO. The blast radius is prompt *noise* in a prompt that only ever
proposes `inbox:proposed` issues — it cannot reach `agent:ready`. Clear it with
`wrangler kv key delete` (see "Extraction learnings" below).

**What never gets logged.** No transcript, no message text, no chat id. Log
lines carry an event name, a repo slug, an issue number, and an error's *class
name* — never its message, which can quote input. Cloudflare's log tail is not a
place the fleet's contents should end up.

Two of those events are worth an alert, because both mean a repo is routing
worse than it should and nothing else says so: `initiatives.file_unreadable`
(that repo's `.fleet/initiatives.json` is unreachable or malformed — routing
fell back to its `init:*` labels) and `initiatives.unavailable` (the labels
failed too, so the extraction prompt is told the repo has no initiatives at
all). An ordinary 404 for a repo with no `.fleet/` directory is the normal case
and is not logged.

**Cost.** Extraction runs on `claude-sonnet-5` at `low` effort — this is reading
what you said, not deciding how to build it. The hard reasoning happens later,
in the agent that picks up an issue, and only after you pressed ✅. The `queue:`
fast path skips the model entirely.

## Extraction learnings

Every ❌ appends a line to `learnings.md` in KV:

```
- Rejected (Togather): "Add a dark mode" — do not propose work like this again.
```

That file is injected into every later extraction prompt, capped at 30 lines,
FIFO. It's the cheapest possible feedback loop — no fine-tuning, no eval
harness, just a running list of what you've already said no to. To inspect or
reset it:

```bash
npx wrangler kv key get --binding INBOX_KV learnings.md
npx wrangler kv key delete --binding INBOX_KV learnings.md
```

## Per-repo initiatives (optional)

A repo can declare its own initiatives so the model routes to real ones instead
of inventing names. Add `.fleet/initiatives.json`:

```json
{
  "initiatives": [
    { "name": "wa-parity", "description": "WhatsApp parity pass on chat" },
    { "name": "inbox", "description": "The fleet inbox pipeline" }
  ]
}
```

A bare array of strings works too. Without the file, the worker falls back to
the repo's existing `init:*` labels — which exist already, because that's what
it files against.

## Development

```bash
pnpm --filter @supa-media/fleet-inbox-worker test        # typecheck + node --test
pnpm --filter @supa-media/fleet-inbox-worker typecheck
```

Tests cover the pure parts — routing heuristics, extraction-response validation,
callback encoding, summary rendering and message mutation, learnings FIFO and
its sanitisation, issue rendering and the untrusted fences, message
classification — plus the GitHub, Anthropic, and Telegram clients against a
mocked `fetch`.

`test/index.test.ts` is deliberately **integration-shaped**: it drives
`handleCallback` and `handleUpdate` end-to-end against mocked HTTP, because the
approval loop's failure modes live *between* correct pure functions rather than
inside any of them. Testing `applyDecision` in isolation passed while the caller
that used it was broken; that gap is what this file exists to close. It also
covers the two authentication functions the security section rests on.

There is no live-API test, by design: the network paths are thin, and the logic
worth protecting isn't in them.

The package is **dependency-free at runtime** and carries only `typescript` and
`@types/node` as dev dependencies. `wrangler` is intentionally not a dependency —
deployment is a separate step with the owner's Cloudflare account, and adding
~90MB of workerd to every CI install to type-check a file we don't deploy isn't
a trade worth making. Use `npx wrangler` when the time comes.

## Not deployed

This ships the worker; it does not run it. Deploying needs the owner's
Cloudflare account for the KV namespace, the Workers AI binding, the six
secrets, and the webhook registration above.
