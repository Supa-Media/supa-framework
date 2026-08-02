/**
 * The label vocabulary the whole pipeline speaks.
 *
 * The dashboard holds no state of its own beyond a "last reviewed" timestamp.
 * Everything it shows and everything it changes is a GitHub label or comment —
 * so these strings are the contract between the dashboard,
 * the overnight orchestrator, the Telegram worker, and the watchdog. They are
 * declared once here and documented in README.md; nothing else may spell them.
 *
 * Lifecycle of an item:
 *
 *   inbox:raw ──(extraction pipeline)──► inbox:proposed ──(you keep it)──► agent:ready
 *                                              └──(you reject it)──► closed
 *
 *   agent:ready ──(you approve the day's plan)──► + plan:approved
 *               ──(an agent picks it up)────────► agent:in-progress
 *               ──(the watchdog parks it)──────► agent:blocked
 *
 * `agent:automerge` and `agent:notify` are orthogonal flags, not states.
 */

export const LABELS = {
  /** Queued work an agent may pick up. */
  ready: "agent:ready",
  /** An agent is on it right now. Drives the ◉ Now view. */
  inProgress: "agent:in-progress",
  /** Parked: three respawns burned, or a human-only blocker. */
  blocked: "agent:blocked",
  /** The item's PR may merge itself once green. Absence means you merge it. */
  automerge: "agent:automerge",
  /** ⚡ — ping Telegram at each milestone instead of batching to review. */
  notify: "agent:notify",
  /** You approved this item in a morning/evening review. */
  planApproved: "plan:approved",
  /** A dump awaiting extraction into individual items. */
  inboxRaw: "inbox:raw",
  /** An extracted item awaiting your keep/reject. */
  inboxProposed: "inbox:proposed",
  /** A watchdog intervention report. */
  watchdogReport: "watchdog:report",
  /**
   * You looked at it and said "not now".
   *
   * The only label whose job is to make an issue **stop** appearing. Triage asks
   * "is the fleet managing this?", and without a way to answer "no, deliberately"
   * the same twenty issues would be offered every morning forever — which is how
   * a triage list becomes another thing you ignore.
   */
  triaged: "fleet:triaged",
} as const;

/** Prefix for the initiative a label assigns, e.g. `init:giving`. */
export const INIT_PREFIX = "init:";
/** Prefix for a t-shirt size, e.g. `size:M`. */
export const SIZE_PREFIX = "size:";

/**
 * Every label that means "the fleet has an opinion about this issue".
 *
 * An open issue carrying **none** of these — and no `init:*` — is untriaged: it
 * was filed and then nothing in the pipeline ever picked it up. That is the whole
 * definition behind the Triage surface, and it is stated here once so the
 * GraphQL exclusion and the client-side selector cannot drift apart.
 *
 * `size:*` is deliberately absent. It is a description, not a decision: an issue
 * labelled only `size:M` has been measured by someone and then dropped, which is
 * exactly the shape triage exists to surface.
 */
export const MANAGED_LABELS: readonly string[] = [
  LABELS.ready,
  LABELS.inProgress,
  LABELS.blocked,
  LABELS.automerge,
  LABELS.notify,
  LABELS.planApproved,
  LABELS.inboxProposed,
  LABELS.inboxRaw,
  LABELS.watchdogReport,
  LABELS.triaged,
];

/**
 * gh-aw stamps every issue its workflows file with this. Paired with the
 * `github-actions` author it identifies an operational report rather than
 * product work — see `selectTriage`.
 */
export const AGENTIC_WORKFLOWS_LABEL = "agentic-workflows";

/**
 * How GitHub spells the Actions bot. Two entries because GraphQL's `author.login`
 * says `github-actions` while REST and the web UI say `github-actions[bot]`, and
 * an issue's provenance must not depend on which API happened to fetch it.
 */
export const AUTOMATION_AUTHORS: readonly string[] = ["github-actions", "github-actions[bot]"];

/**
 * Whether the fleet is managing this issue at all.
 *
 * `init:*` counts even on its own: naming an initiative is a human saying where
 * the work belongs, which is more triage than most issues ever get.
 */
export function isManaged(labels: readonly string[]): boolean {
  return labels.some((name) => MANAGED_LABELS.includes(name) || name.startsWith(INIT_PREFIX));
}

export interface LabelLike {
  name: string;
}

export function hasLabel(labels: readonly LabelLike[], name: string): boolean {
  return labels.some((label) => label.name === name);
}

/**
 * The `init:*` labels on an item, prefix stripped.
 *
 * Plural because an item can legitimately span two initiatives, and silently
 * picking the first would make the second invisible in the Apps view.
 */
export function initiativeLabels(labels: readonly LabelLike[]): string[] {
  return labels
    .filter((label) => label.name.startsWith(INIT_PREFIX))
    .map((label) => label.name.slice(INIT_PREFIX.length))
    .filter((name) => name !== "");
}

/**
 * The `size:*` label's value, uppercased, or `null`.
 *
 * Uppercased because `size:m` and `size:M` are the same size to a human and
 * GitHub label names are case-sensitive — leaving both through would render two
 * different pills for one concept.
 */
export function sizeLabel(labels: readonly LabelLike[]): string | null {
  for (const label of labels) {
    if (!label.name.startsWith(SIZE_PREFIX)) continue;
    const value = label.name.slice(SIZE_PREFIX.length).trim();
    if (value !== "") return value.toUpperCase();
  }
  return null;
}

/**
 * Labels to keep when an inbox item is accepted.
 *
 * Accepting is "swap `inbox:proposed` for `agent:ready`", not "replace the
 * label set": the extraction pipeline writes `init:*` (and sometimes `size:*`)
 * onto the proposal, and dropping those would strand the item outside any
 * initiative the moment you said yes to it.
 */
export function labelsAfterKeep(labels: readonly LabelLike[]): string[] {
  const kept = labels
    .map((label) => label.name)
    .filter((name) => name !== LABELS.inboxProposed && name !== LABELS.inboxRaw);
  return kept.includes(LABELS.ready) ? kept : [...kept, LABELS.ready];
}
