# @supa-media/fleet-inbox-worker

## 0.1.0

### Minor Changes

- 37637b1: New workspace package: the fleet inbox, as a Cloudflare Worker.

  A voice note, video, forwarded message, or line of text sent to a Telegram bot
  becomes reviewed, routed, proposed work items across the fleet. Audio is
  transcribed with Workers AI Whisper (`@cf/openai/whisper`); the transcript is
  read by `claude-sonnet-5` at `low` effort — extraction, not implementation —
  against each repo's declared initiatives (`.fleet/initiatives.json`, falling
  back to its `init:*` labels); each item is routed by domain vocabulary and filed
  as a GitHub issue with a criteria checklist, a verbatim source quote, and a
  `**[source]**` marker naming the Telegram message it came from. The bot replies
  with the list and a ✅ keep / ❌ reject / ✏️ edit button per item.

  **Nothing executes.** Every issue is filed `inbox:proposed`, which no agent
  picks up; work becomes real only when ✅ flips the label to `agent:ready` — and
  the keep path refuses any issue not currently carrying `inbox:proposed`, so it
  can only ever promote items this worker filed and the owner hasn't decided on.
  Filed issues are PAT-authored, meaning `author_association: OWNER`, which the
  fleet's orchestrator trusts; the chat allowlist is therefore what makes them
  safe for a downstream agent to act on, and the README's "Trust model" section
  states that coupling along with the four controls that hold it. The Telegram
  summary renders each item's acceptance criteria so ✅ approves text that was
  actually displayed, and forwarded (third-party) content is flagged in the
  extraction prompt, the issue body, and the summary.

  Rejecting closes the issue and appends a line to a `learnings.md` in KV that is
  injected into later extraction prompts (30 lines, FIFO) — the cheapest possible
  feedback loop. `queue: <text>` is a fast path that files one item with no model
  call at all.

  Two gates protect the endpoint, both before any work happens: the
  `X-Telegram-Bot-Api-Secret-Token` header is verified byte-by-byte against a
  secret, and only the single configured `TELEGRAM_CHAT_ID` is answered —
  everything else gets a silent 200 and a log line carrying no ids or content.
  The worker holds a fine-grained PAT scoped to the four fleet repos with
  `issues:write` and `contents:read`; it cannot push, merge, or open a pull
  request. That is the one place the fleet holds power, so it is the smallest
  scope that still does the job.

  The package is `private: true` (a deployable worker, not a published library)
  and has no runtime dependencies — the Cloudflare binding types it needs are
  hand-declared rather than pulling in `@cloudflare/workers-types`, and `wrangler`
  is invoked with `npx` rather than installed into CI. Unit tests cover the pure
  logic (routing heuristics, extraction-response validation, callback encoding and
  message mutation, learnings FIFO, issue rendering, message classification) plus
  the GitHub and Anthropic clients against a mocked `fetch`.

  **Not deployed.** Deployment is a follow-up with the owner's Cloudflare
  account — the KV namespace, the AI binding, the five secrets, and the webhook
  registration are all documented in the package README.
