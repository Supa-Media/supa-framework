/**
 * The approval surface: inline keyboard encoding, and what a decision does to
 * the summary message.
 *
 * Telegram caps `callback_data` at **64 bytes**, which rules out putting the
 * repo slug (`Supa-Media/supa-framework` alone is 25) or the issue URL in
 * there. The encoding is `<action>|<app key>|<issue number>` — the app key
 * resolves to a slug through `fleet.ts`, so the payload stays under 20 bytes
 * for every real fleet repo.
 *
 * `applyDecision` is pure so the message-mutation rules — which button
 * disappears, what the transcript line says — are testable without a Telegram
 * account. The worker's callback handler does the GitHub write and then hands
 * the result here.
 */

import { UNASSIGNED } from "./fleet";

/** Telegram's hard limit on `callback_data`. */
export const CALLBACK_DATA_MAX_BYTES = 64;

export type CallbackAction = "keep" | "reject";

export interface CallbackPayload {
  action: CallbackAction;
  appKey: string;
  issueNumber: number;
}

const ACTION_CODES: Record<CallbackAction, string> = { keep: "k", reject: "r" };

export function encodeCallback(payload: CallbackPayload): string {
  const encoded = `${ACTION_CODES[payload.action]}|${payload.appKey}|${payload.issueNumber}`;
  if (new TextEncoder().encode(encoded).length > CALLBACK_DATA_MAX_BYTES) {
    // Unreachable with the current fleet (longest key is `events-os`), but an
    // over-long payload is silently rejected by Telegram at send time — a
    // broken keyboard with no error. Fail loudly at build time instead.
    throw new Error(`callback_data exceeds ${CALLBACK_DATA_MAX_BYTES} bytes: ${encoded}`);
  }
  return encoded;
}

/** Decode `callback_data`, or `null` when it isn't ours / is malformed. */
export function parseCallback(data: string | undefined): CallbackPayload | null {
  if (typeof data !== "string") return null;

  const parts = data.split("|");
  if (parts.length !== 3) return null;

  const [code, appKey, rawNumber] = parts as [string, string, string];
  const action = (Object.keys(ACTION_CODES) as CallbackAction[]).find(
    (candidate) => ACTION_CODES[candidate] === code,
  );
  if (action === undefined) return null;
  if (appKey === "") return null;

  // `Number("12abc")` is NaN but `parseInt` would happily return 12 — an issue
  // number is either the whole field or the payload isn't ours.
  const issueNumber = Number(rawNumber);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;

  return { action, appKey, issueNumber };
}

/** One proposed item as it appears in the summary message and its keyboard. */
export interface Proposal {
  appKey: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  /**
   * The acceptance criteria filed on the issue. Rendered in the summary so ✅
   * approves something that was actually shown — see {@link renderSummary}.
   */
  criteria: string[];
  /** True when the content came from a forward rather than the owner's voice. */
  thirdParty: boolean;
}

/** How many criteria are shown per item before the summary points at the issue. */
export const SUMMARY_CRITERIA_LIMIT = 4;
/** Criteria longer than this are truncated in the summary (never on the issue). */
export const SUMMARY_CRITERION_CHARS = 120;

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * The approval message.
 *
 * Renders each proposal's **acceptance criteria**, not just its title — that is
 * the entire point of this function. ✅ promotes an issue body to
 * `agent:ready`, and an earlier version showed only an 80-character title, so
 * the owner was approving text he had never seen: the criteria and the source
 * quote (exactly where a crafted instruction would sit) were reachable only
 * through the ✏️ link. Showing the criteria makes the default gesture an
 * informed one.
 *
 * Long lists are capped and long lines truncated, with an explicit "+N more"
 * and the issue link, so a wall of criteria cannot push the buttons off the
 * screen — but the message never silently hides that there is more to read.
 *
 * Plain text, no Markdown — see `TelegramClient.sendMessage`.
 */
export function renderSummary(
  headline: string,
  proposals: readonly Proposal[],
): string {
  const blocks = proposals.map((proposal, index) => {
    const lines = [`${index + 1}. ${proposal.title}  (#${proposal.issueNumber})`];

    if (proposal.thirdParty) {
      lines.push("   ⚠️ forwarded content — not your own words");
    }

    if (proposal.criteria.length === 0) {
      lines.push("   • no acceptance criteria captured");
    } else {
      for (const criterion of proposal.criteria.slice(0, SUMMARY_CRITERIA_LIMIT)) {
        lines.push(`   • ${truncate(criterion, SUMMARY_CRITERION_CHARS)}`);
      }
      const hidden = proposal.criteria.length - SUMMARY_CRITERIA_LIMIT;
      if (hidden > 0) lines.push(`   • +${hidden} more — ${proposal.issueUrl}`);
    }

    return lines.join("\n");
  });

  return [
    headline,
    "",
    blocks.join("\n\n"),
    "",
    "All inbox:proposed. Nothing runs until you keep it.",
  ].join("\n");
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboard = InlineButton[][];

/**
 * One row per proposal: keep / reject / edit.
 *
 * ✏️ is a `url` button rather than a callback — editing means opening the issue
 * on GitHub, and a URL button does that without a round trip through the
 * worker. That's also why the callback encoding only needs two actions.
 */
export function buildKeyboard(proposals: readonly Proposal[]): InlineKeyboard {
  return proposals.map((proposal, index) => [
    {
      text: `${index + 1} ✅ keep`,
      callback_data: encodeCallback({
        action: "keep",
        appKey: proposal.appKey,
        issueNumber: proposal.issueNumber,
      }),
    },
    {
      text: "❌ reject",
      callback_data: encodeCallback({
        action: "reject",
        appKey: proposal.appKey,
        issueNumber: proposal.issueNumber,
      }),
    },
    { text: "✏️ edit", url: proposal.issueUrl },
  ]);
}

export interface DecisionOutcome {
  /** The edited message text. */
  text: string;
  /** The keyboard with the decided item's row removed. */
  keyboard: InlineKeyboard;
}

/**
 * Fold a decision into the summary message.
 *
 * Appends an audit line and drops that item's button row, so the message
 * becomes a record of what was decided and the same button can't be pressed
 * twice. Rows are matched on the callback payload rather than on position —
 * Telegram delivers the payload, not an index, and rows shift as earlier ones
 * are removed.
 *
 * A payload with no matching row (an already-decided item, or a button from an
 * older message) returns the input unchanged rather than appending a duplicate
 * line.
 */
export function applyDecision(
  text: string,
  keyboard: InlineKeyboard,
  payload: CallbackPayload,
  issueTitle: string,
): DecisionOutcome {
  const rowMatches = (row: InlineButton[]): boolean =>
    row.some((button) => {
      const decoded = parseCallback(button.callback_data);
      return (
        decoded !== null &&
        decoded.appKey === payload.appKey &&
        decoded.issueNumber === payload.issueNumber
      );
    });

  if (!keyboard.some(rowMatches)) return { text, keyboard };

  const marker = payload.action === "keep" ? "✅ kept" : "❌ rejected";
  const line = `${marker} #${payload.issueNumber} — ${issueTitle}`;

  return {
    text: `${text}\n${line}`,
    keyboard: keyboard.filter((row) => !rowMatches(row)),
  };
}

/**
 * The `queue: <text>` fast path.
 *
 * A plain-text shortcut that skips extraction entirely: one line in, one item
 * out, no model call. Returns the text after the prefix, or `null` when the
 * message isn't a queue command.
 */
export function parseQueueCommand(text: string | undefined): string | null {
  if (typeof text !== "string") return null;
  const match = /^\s*queue\s*:\s*([\s\S]+)$/i.exec(text);
  const body = match?.[1]?.trim();
  return body === undefined || body === "" ? null : body;
}

/** The app key shown when a proposal couldn't be routed. */
export const UNASSIGNED_APP_KEY = UNASSIGNED;
