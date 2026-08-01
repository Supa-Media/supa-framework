/**
 * The fleet inbox: Telegram in, proposed GitHub issues out.
 *
 * A voice note, video, forwarded message, or line of text arrives from exactly
 * one chat. It is transcribed if it needs to be, read by a model that writes
 * down what was asked for, routed to the repo whose vocabulary it matches, and
 * filed as `inbox:proposed` issues. The bot replies with the list and a keep /
 * reject / edit button per item.
 *
 * **Nothing executes.** Every issue this worker files is labelled
 * `inbox:proposed`, and no agent picks those up. Work only becomes real when
 * the owner presses ✅ and the label flips to `agent:ready`. That is the whole
 * safety model, and it is deliberately boring.
 *
 * The security posture is in README.md; the two enforcement points are
 * `secretMatches` (Telegram is who it claims) and `isAllowedChat` (and it's
 * the right chat) — both below, before anything else runs.
 */

import {
  applyDecision,
  buildKeyboard,
  parseCallback,
  parseQueueCommand,
  type InlineKeyboard,
  type Proposal,
} from "./callback";
import { callExtraction, type FleetContext } from "./extract";
import { FLEET_APPS, UNASSIGNED, labelForApp, slugForApp } from "./fleet";
import { GitHubClient } from "./github";
import {
  clampTitle,
  issueLabels,
  planEditLabels,
  renderIssueBody,
  renderPlanEditBody,
  renderPlanEditTitle,
  PROPOSED_LABEL,
  READY_LABEL,
  type SourceRef,
} from "./issue";
import { appendLearning, formatRejectionLearning, readLearnings } from "./learnings";
import { routeApp } from "./routing";
import { describeMessage, TelegramClient, type TelegramUpdate } from "./telegram";
import { transcribe } from "./transcribe";
import { parseExtraction, type ExtractedItem, type PlanEdit } from "./validate";
import type { Env, ExecutionContext } from "./env";

const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

/**
 * Constant-time-ish string comparison.
 *
 * The webhook secret is a fixed 40+ character token, so a timing oracle here is
 * a stretch — but comparing every byte costs nothing and removes the question.
 * Length is compared first (and leaks, unavoidably, as it does in every
 * implementation of this).
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function isAllowedChat(chatId: number | undefined, expected: string): boolean {
  return chatId !== undefined && String(chatId) === expected;
}

/**
 * Structured log line. Deliberately carries no message text, chat id, or
 * transcript — Cloudflare's log tail is a place the fleet's contents should
 * never end up.
 */
function log(event: string, fields: Record<string, string | number> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("fleet-inbox-worker\n", {
        headers: { "content-type": "text/plain" },
      });
    }

    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }

    if (!secretMatches(request.headers.get(SECRET_HEADER), env.TELEGRAM_WEBHOOK_SECRET)) {
      log("webhook.rejected", { reason: "bad_secret" });
      return new Response("Unauthorized", { status: 401 });
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      log("webhook.rejected", { reason: "malformed_json" });
      return new Response("Bad request", { status: 400 });
    }

    // Past this point Telegram is authenticated, so always answer 200 — a
    // non-2xx makes Telegram redeliver the same update, and a bug that throws
    // would turn into an infinite retry loop that files the same issues again
    // and again.
    ctx.waitUntil(handleUpdate(update, env));
    return new Response("ok");
  },
};

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);

  try {
    if (update.callback_query !== undefined) {
      await handleCallback(update.callback_query, env, telegram);
      return;
    }

    const message = update.message ?? update.channel_post;
    if (message === undefined) {
      log("update.ignored", { reason: "no_message" });
      return;
    }

    if (!isAllowedChat(message.chat?.id, env.TELEGRAM_CHAT_ID)) {
      log("update.ignored", { reason: "chat_not_allowed" });
      return;
    }

    await handleMessage(message, env, telegram);
  } catch (error) {
    log("update.failed", { error: error instanceof Error ? error.name : "unknown" });
    try {
      await telegram.sendMessage(
        env.TELEGRAM_CHAT_ID,
        `Something broke handling that: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } catch {
      // If Telegram itself is the thing that's broken there is nowhere left to
      // report to. The log line above is the record.
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

async function handleMessage(
  message: NonNullable<TelegramUpdate["message"]>,
  env: Env,
  telegram: TelegramClient,
): Promise<void> {
  const described = describeMessage(message);
  const github = new GitHubClient(env.GH_TOKEN);
  const source: SourceRef = {
    messageId: message.message_id,
    kind: described.kind,
    filedAt: new Date().toISOString(),
  };

  // Fast path: `queue: <text>` files one item with no model call at all. It
  // exists because the owner already knows what he wants sometimes, and paying
  // for extraction to restate it is silly.
  const queued = parseQueueCommand(described.text);
  if (queued !== null && described.media === null) {
    // No model runs on this path, so routing uses the same vocabulary
    // heuristic the extraction prompt asks the model to follow.
    const item: ExtractedItem = {
      title: clampTitle(queued),
      acceptance_criteria: [],
      app: routeApp(queued),
      initiative: "misc",
      is_new_initiative: false,
      size: "m",
      source_quote: queued,
    };
    const proposals = await fileItems(github, [item], { ...source, kind: "queue" });
    await reply(telegram, env, "Queued one item.", proposals);
    return;
  }

  let transcript = described.text;
  if (described.media !== null) {
    const result = await transcribe(env, telegram, described.media);
    if (!result.ok) {
      await telegram.sendMessage(env.TELEGRAM_CHAT_ID, result.reason);
      return;
    }
    // A caption on a voice note is context for the transcript, not a rival to
    // it — keep both, clearly separated.
    transcript = described.text === "" ? result.text : `${result.text}\n\n(caption: ${described.text})`;
  }

  if (transcript.trim() === "") {
    await telegram.sendMessage(env.TELEGRAM_CHAT_ID, "There was nothing in that I could read.");
    return;
  }

  const context = await loadFleetContext(github);
  const learnings = await readLearnings(env.INBOX_KV);
  const called = await callExtraction(env, {
    transcript,
    sourceKind: described.kind,
    context,
    learnings,
  });
  if (!called.ok) {
    await telegram.sendMessage(env.TELEGRAM_CHAT_ID, called.reason);
    return;
  }

  const parsed = parseExtraction(called.raw);
  if (!parsed.ok) {
    log("extraction.invalid", { errors: parsed.errors.join("; ") });
    await telegram.sendMessage(
      env.TELEGRAM_CHAT_ID,
      `I couldn't read the extraction back: ${parsed.errors.join("; ")}`,
    );
    return;
  }
  if (parsed.warnings.length > 0) {
    log("extraction.warnings", { warnings: parsed.warnings.join("; ") });
  }

  const { items, plan_edits: planEdits } = parsed.value;
  if (items.length === 0 && planEdits.length === 0) {
    await telegram.sendMessage(env.TELEGRAM_CHAT_ID, "Nothing actionable in that one.");
    return;
  }

  const proposals = await fileItems(github, items, source);
  proposals.push(...(await filePlanEdits(github, planEdits, source)));

  const summary =
    planEdits.length === 0
      ? `Proposed ${items.length} item${items.length === 1 ? "" : "s"}.`
      : `Proposed ${items.length} item${items.length === 1 ? "" : "s"} and ${planEdits.length} plan edit${planEdits.length === 1 ? "" : "s"}.`;
  await reply(telegram, env, summary, proposals);
}

async function loadFleetContext(github: GitHubClient): Promise<FleetContext[]> {
  return Promise.all(
    FLEET_APPS.map(async (app) => ({
      appKey: app.key,
      label: app.label,
      slug: app.slug,
      initiatives: await github.listInitiatives(app.slug),
    })),
  );
}

async function fileItems(
  github: GitHubClient,
  items: readonly ExtractedItem[],
  source: SourceRef,
): Promise<Proposal[]> {
  const proposals: Proposal[] = [];
  for (const item of items) {
    const slug = slugForApp(item.app);
    const issue = await github.createIssue(slug, {
      title: clampTitle(item.title),
      body: renderIssueBody(item, source),
      labels: issueLabels(item),
    });
    proposals.push({
      appKey: item.app === UNASSIGNED ? "framework" : item.app,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      title: `[${labelForApp(item.app)}] ${clampTitle(item.title, 80)}`,
    });
    log("issue.proposed", { repo: slug, number: issue.number, size: item.size });
  }
  return proposals;
}

async function filePlanEdits(
  github: GitHubClient,
  edits: readonly PlanEdit[],
  source: SourceRef,
): Promise<Proposal[]> {
  const proposals: Proposal[] = [];
  for (const edit of edits) {
    const slug = slugForApp(edit.app);
    const issue = await github.createIssue(slug, {
      title: clampTitle(renderPlanEditTitle(edit)),
      body: renderPlanEditBody(edit, source),
      labels: planEditLabels(),
    });
    proposals.push({
      appKey: edit.app === UNASSIGNED ? "framework" : edit.app,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      title: `[plan edit] ${clampTitle(edit.target, 60)}`,
    });
    log("planEdit.proposed", { repo: slug, number: issue.number, type: edit.type });
  }
  return proposals;
}

function renderSummary(headline: string, proposals: readonly Proposal[]): string {
  const lines = proposals.map(
    (proposal, index) => `${index + 1}. ${proposal.title} — #${proposal.issueNumber}`,
  );
  return [headline, "", ...lines, "", `All \`${PROPOSED_LABEL}\`. Nothing runs until you keep it.`].join("\n");
}

async function reply(
  telegram: TelegramClient,
  env: Env,
  headline: string,
  proposals: readonly Proposal[],
): Promise<void> {
  if (proposals.length === 0) {
    await telegram.sendMessage(env.TELEGRAM_CHAT_ID, "Nothing to propose.");
    return;
  }
  await telegram.sendMessage(
    env.TELEGRAM_CHAT_ID,
    renderSummary(headline, proposals),
    buildKeyboard(proposals),
  );
}

/* -------------------------------------------------------------------------- */
/* Button presses                                                              */
/* -------------------------------------------------------------------------- */

async function handleCallback(
  query: NonNullable<TelegramUpdate["callback_query"]>,
  env: Env,
  telegram: TelegramClient,
): Promise<void> {
  if (!isAllowedChat(query.message?.chat?.id, env.TELEGRAM_CHAT_ID)) {
    log("callback.ignored", { reason: "chat_not_allowed" });
    return;
  }

  const payload = parseCallback(query.data);
  if (payload === null) {
    log("callback.ignored", { reason: "unparseable" });
    await telegram.answerCallbackQuery(query.id, "That button is stale.");
    return;
  }

  const slug = slugForApp(payload.appKey);
  const github = new GitHubClient(env.GH_TOKEN);
  const issue = await github.getIssue(slug, payload.issueNumber);

  if (payload.action === "keep") {
    await github.removeLabel(slug, payload.issueNumber, PROPOSED_LABEL);
    await github.addLabels(slug, payload.issueNumber, [READY_LABEL]);
    log("issue.kept", { repo: slug, number: payload.issueNumber });
  } else {
    await github.comment(slug, payload.issueNumber, "rejected via Telegram");
    await github.closeIssue(slug, payload.issueNumber);
    await appendLearning(
      env.INBOX_KV,
      formatRejectionLearning(issue.title, payload.appKey),
    );
    log("issue.rejected", { repo: slug, number: payload.issueNumber });
  }

  const message = query.message;
  if (message !== undefined) {
    const keyboard: InlineKeyboard = message.reply_markup?.inline_keyboard ?? [];
    const outcome = applyDecision(message.text ?? "", keyboard, payload, issue.title);
    await telegram.editMessageText(
      env.TELEGRAM_CHAT_ID,
      message.message_id,
      outcome.text,
      outcome.keyboard,
    );
  }

  await telegram.answerCallbackQuery(
    query.id,
    payload.action === "keep" ? "Kept — marked agent:ready." : "Rejected and closed.",
  );
}
