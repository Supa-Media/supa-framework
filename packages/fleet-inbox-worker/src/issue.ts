/**
 * Rendering an extracted item into the GitHub issue that represents it.
 *
 * Pure string building, kept out of `github.ts` so the body format — the thing
 * a human actually reads, and the thing an agent later parses — is testable
 * without a network client.
 *
 * Every proposal carries a `**[source]**` marker naming the Telegram message it
 * came from. That marker is the audit trail: months later it answers "where did
 * this issue come from" with something better than "the inbox bot".
 */

import { labelForApp } from "./fleet";
import type { ExtractedItem, PlanEdit } from "./validate";

/** Applied to everything this worker files. Nothing acts on a proposal. */
export const PROPOSED_LABEL = "inbox:proposed";
/** Replaces {@link PROPOSED_LABEL} when the owner presses ✅. */
export const READY_LABEL = "agent:ready";
/** Marks an issue that changes an existing plan rather than adding work. */
export const PLAN_EDIT_LABEL = "plan-edit";

export interface SourceRef {
  /** Telegram's message id. */
  messageId: number;
  /** How the content arrived: `voice`, `video`, `text`, `forward`, `queue`. */
  kind: string;
  /** ISO timestamp of when the worker filed the proposal. */
  filedAt: string;
}

/**
 * Turn an initiative name into a label-safe slug.
 *
 * GitHub accepts nearly anything in a label, but `init:WA Parity` and
 * `init:wa-parity` are two different labels for one initiative — and
 * fleet-dashboard groups by branch prefix, which is already kebab-case. Slugging
 * here keeps the two views agreeing.
 */
export function slugifyInitiative(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  return slug === "" ? "misc" : slug;
}

/** `inbox:proposed`, the initiative label, and the size label. */
export function issueLabels(item: ExtractedItem): string[] {
  return [
    PROPOSED_LABEL,
    `init:${slugifyInitiative(item.initiative)}`,
    `size:${item.size}`,
  ];
}

function renderSource(source: SourceRef): string {
  return `**[source]** telegram-message:${source.messageId} · ${source.kind} · ${source.filedAt}`;
}

export function renderIssueBody(item: ExtractedItem, source: SourceRef): string {
  const sections: string[] = [];

  if (item.acceptance_criteria.length > 0) {
    sections.push(
      ["## Acceptance criteria", "", ...item.acceptance_criteria.map((c) => `- [ ] ${c}`)].join("\n"),
    );
  } else {
    sections.push(
      "## Acceptance criteria\n\n_None captured — the source didn't specify what done looks like._",
    );
  }

  if (item.source_quote !== "") {
    sections.push(`## Source\n\n> ${item.source_quote.replace(/\n/g, "\n> ")}`);
  }

  const routing = item.is_new_initiative
    ? `Routed to **${labelForApp(item.app)}** under a **new** initiative \`${item.initiative}\`.`
    : `Routed to **${labelForApp(item.app)}** under \`${item.initiative}\`.`;
  sections.push(routing);

  sections.push(
    `Proposed by the fleet inbox — labelled \`${PROPOSED_LABEL}\`, so nothing acts on it until it is relabelled \`${READY_LABEL}\`.`,
  );
  sections.push(renderSource(source));

  return sections.join("\n\n");
}

export function renderPlanEditTitle(edit: PlanEdit): string {
  return `Plan edit (${edit.type}): ${edit.target}`;
}

export function renderPlanEditBody(edit: PlanEdit, source: SourceRef): string {
  return [
    `## ${edit.type}`,
    "",
    `**Target:** ${edit.target}`,
    "",
    "## Reason",
    "",
    edit.reason === "" ? "_No reason captured._" : edit.reason,
    "",
    `This changes an existing plan rather than adding work. Labelled \`${PROPOSED_LABEL}\` — apply it only after review.`,
    "",
    renderSource(source),
  ].join("\n");
}

export function planEditLabels(): string[] {
  return [PROPOSED_LABEL, PLAN_EDIT_LABEL];
}

/**
 * GitHub rejects issue titles over 256 characters. A dictated item can easily
 * run longer, and a 422 at file time would lose the item entirely.
 */
export function clampTitle(title: string, max = 200): string {
  const collapsed = title.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
