import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampTitle,
  issueLabels,
  planEditLabels,
  renderIssueBody,
  renderPlanEditBody,
  renderPlanEditTitle,
  slugifyInitiative,
  PLAN_EDIT_LABEL,
  PROPOSED_LABEL,
} from "../src/issue";
import type { ExtractedItem, PlanEdit } from "../src/validate";

const source = { messageId: 1234, kind: "voice", filedAt: "2026-08-01T09:00:00.000Z" };

const item: ExtractedItem = {
  title: "Let a leader pin a thread",
  acceptance_criteria: ["Pinned thread shows at the top", "Only leaders can pin"],
  app: "togather",
  initiative: "wa-parity",
  is_new_initiative: false,
  size: "m",
  source_quote: "leaders should be able to pin a thread",
};

test("labels are proposed + initiative + size", () => {
  assert.deepEqual(issueLabels(item), ["inbox:proposed", "init:wa-parity", "size:m"]);
});

test("initiative slugs are kebab-case and stable", () => {
  assert.equal(slugifyInitiative("WA Parity"), "wa-parity");
  assert.equal(slugifyInitiative("  feat/Finance V2  "), "feat/finance-v2");
  assert.equal(slugifyInitiative("a—b…c"), "a-b-c");
  assert.equal(slugifyInitiative("--trimmed--"), "trimmed");
  assert.equal(slugifyInitiative("!!!"), "misc", "an unusable name still yields a valid label");
  assert.equal(slugifyInitiative(""), "misc");
});

test("the body carries criteria, quote, routing, and the source marker", () => {
  const body = renderIssueBody(item, source);
  assert.match(body, /- \[ \] Pinned thread shows at the top/);
  assert.match(body, /- \[ \] Only leaders can pin/);
  assert.match(body, /> leaders should be able to pin a thread/);
  assert.match(body, /Routed to \*\*Togather\*\* under `wa-parity`/);
  assert.match(body, /\*\*\[source\]\*\* telegram-message:1234 · voice · 2026-08-01T09:00:00\.000Z/);
  assert.match(body, /inbox:proposed/);
});

test("no criteria says so rather than shipping an empty checklist", () => {
  const body = renderIssueBody({ ...item, acceptance_criteria: [] }, source);
  assert.match(body, /None captured/);
  assert.doesNotMatch(body, /- \[ \]/);
});

test("a multi-line source quote stays inside the blockquote", () => {
  const body = renderIssueBody({ ...item, source_quote: "line one\nline two" }, source);
  assert.match(body, /> line one\n> line two/);
});

test("a new initiative is flagged in the body", () => {
  const body = renderIssueBody({ ...item, is_new_initiative: true, initiative: "inbox" }, source);
  assert.match(body, /\*\*new\*\* initiative `inbox`/);
});

test("an unassigned item still renders a sensible label", () => {
  const body = renderIssueBody({ ...item, app: "unassigned" }, source);
  assert.match(body, /Routed to \*\*Unassigned\*\*/);
});

const edit: PlanEdit = {
  type: "cancel",
  target: "finance-v2-split",
  app: "events-os",
  reason: "superseded by the money page",
};

test("plan edits get their own title, body, and labels", () => {
  assert.equal(renderPlanEditTitle(edit), "Plan edit (cancel): finance-v2-split");
  const body = renderPlanEditBody(edit, source);
  assert.match(body, /\*\*Target:\*\* finance-v2-split/);
  assert.match(body, /superseded by the money page/);
  assert.match(body, /\*\*\[source\]\*\* telegram-message:1234/);
  assert.deepEqual(planEditLabels(), [PROPOSED_LABEL, PLAN_EDIT_LABEL]);
});

test("a plan edit with no reason says so", () => {
  assert.match(renderPlanEditBody({ ...edit, reason: "" }, source), /No reason captured/);
});

test("titles are collapsed and clamped below GitHub's limit", () => {
  assert.equal(clampTitle("  a   b \n c "), "a b c");
  const long = clampTitle("x".repeat(400));
  assert.equal(long.length, 200);
  assert.ok(long.endsWith("…"));
  assert.equal(clampTitle("short", 200), "short");
});
