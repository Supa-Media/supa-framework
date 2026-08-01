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

### The video caveat

There is no ffmpeg in a Cloudflare Worker, so there is no way to demux a video's
audio track first. The worker sends the container bytes to Whisper and lets it
try. That works for the plain MP4 a phone records and not for much else — and
when it fails, the bot says so ("Workers AI couldn't get audio out of that video
— send it as a voice note, or type it") instead of returning an empty transcript
that looks identical to a voice note that recorded silence.

## Setup

### 1. BotFather (3 steps)

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → name it → copy the
   token it gives you. That's `TELEGRAM_BOT_TOKEN`.
2. `/setprivacy` → select the bot → **Disable**. (Only needed if you'll use it in
   a group; in a 1:1 chat the default is fine.)
3. Message your new bot once, then find your chat id:
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
   ```
   That number is `TELEGRAM_CHAT_ID` — the **only** chat this worker will ever
   answer.

### 2. Secrets

Five, all set with `wrangler secret put`. None of them appear in
`wrangler.jsonc`, and none are ever committed:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN       # from BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # you invent this: openssl rand -hex 32
npx wrangler secret put TELEGRAM_CHAT_ID         # your chat id, digits only
npx wrangler secret put ANTHROPIC_API_KEY        # extraction only
npx wrangler secret put GH_TOKEN                 # see "The token" below
```

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
    "allowed_updates": ["message", "callback_query"]
  }'
```

Check it took:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## The security model, honestly

This worker is **the one place in the fleet that holds power**. Everything else
reads. So the scope is as small as it can be while still doing the job:

**The token.** `GH_TOKEN` is a GitHub **fine-grained personal access token**,
scoped to exactly four repositories:

- `togathernyc/togather`
- `Supa-Media/events-os`
- `shyoh/fount-studios`
- `Supa-Media/supa-framework`

with exactly two repository permissions:

- **Issues: Read and write** — file proposals, label, comment, close
- **Contents: Read** — read `.fleet/initiatives.json`, nothing more
- (Metadata: Read is mandatory on every fine-grained token)

It cannot push a commit, open a pull request, merge anything, or touch a repo
outside that list. Give it the shortest expiry you'll tolerate re-issuing.
Everything the token is used for lives in one file, `src/github.ts` — that's
deliberate, so "what can the inbox actually do to my repos" has a short answer.

**Who can talk to it.** Two gates, both before any work happens:

1. **Secret-token verification.** Telegram echoes
   `X-Telegram-Bot-Api-Secret-Token` on every delivery; a request without the
   matching value gets a 401 and nothing else. Compared byte-by-byte rather than
   with `===`.
2. **Single-chat allowlist.** Even a correctly-signed update from any chat other
   than `TELEGRAM_CHAT_ID` is dropped with a silent 200 and a log line that
   records only `chat_not_allowed` — no id, no message text.

**What this does *not* protect against.** If someone gets your bot token they
can read messages sent to the bot; if they get the webhook secret *and* can
reach the worker URL they can forge updates that look like they came from your
chat — the chat-id check reads the forged payload, not a signature over it.
Rotate both if either leaks. The blast radius even then is bounded by the token
above: proposed issues in four repos, which you can see and close.

**What never gets logged.** No transcript, no message text, no chat id. Log
lines carry an event name, a repo slug, and an issue number. Cloudflare's log
tail is not a place the fleet's contents should end up.

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
callback encoding and message mutation, learnings FIFO, issue rendering, message
classification — plus the GitHub and Anthropic clients against a mocked `fetch`.
There is no live-API test, by design: the network paths are thin, and the logic
worth protecting isn't in them.

The package is **dependency-free at runtime** and carries only `typescript` and
`@types/node` as dev dependencies. `wrangler` is intentionally not a dependency —
deployment is a separate step with the owner's Cloudflare account, and adding
~90MB of workerd to every CI install to type-check a file we don't deploy isn't
a trade worth making. Use `npx wrangler` when the time comes.

## Not deployed

This ships the worker; it does not run it. Deploying needs the owner's
Cloudflare account for the KV namespace, the Workers AI binding, the five
secrets, and the webhook registration above.
