import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPaletteOptions,
  describeWrite,
  initialCursor,
  issueTitle,
  resolveEnter,
  type PaletteOption,
} from "../src/lib/palette";

const VIEWS = [
  { id: "review" as const, label: "☀️ Review" },
  { id: "inbox" as const, label: "📥 Inbox" },
  { id: "queue" as const, label: "☰ Queue" },
];

const REPOS = [
  { slug: "togathernyc/togather", label: "Togather" },
  { slug: "Supa-Media/events-os", label: "Events OS" },
];

function options(query: string): PaletteOption[] {
  return buildPaletteOptions({
    query,
    views: VIEWS,
    repos: REPOS,
    claudeCodeUrl: "https://claude.ai/code",
    readyLabel: "agent:ready",
    rawLabel: "inbox:raw",
  });
}

/**
 * The regression this whole module exists for: v2's first palette pushed
 * `File issue → <repo>` above every nav entry whenever the query was non-empty
 * and reset the cursor to 0, so ↵ after typing filed a live `agent:ready` issue
 * in a production repo with no confirmation — while the Copilot view told you to
 * type a view name and press ↵.
 */
test("↵ after typing never resolves to a write, whatever was typed", () => {
  const typed = [
    "queue",
    "q",
    "fix the thread reply bug on togather",
    "Events OS",
    "  ",
    "review",
    "!!!",
    "file issue",
    "🔐",
  ];

  for (const query of typed) {
    const list = options(query);
    const cursor = initialCursor(list);
    const intent = resolveEnter(list, cursor, null);
    assert.notEqual(
      intent.type,
      "commit",
      `"${query}" reached a write with one keystroke and no confirm`,
    );
    assert.ok(
      intent.type === "navigate" || intent.type === "none",
      `"${query}" resolved ↵ to ${intent.type}, which is not navigation`,
    );
    if (cursor >= 0) assert.equal(list[cursor]?.kind, "nav");
  }
});

test("a query matching no view highlights nothing, and ↵ does nothing", () => {
  const list = options("dedupe offline retries by client id");
  assert.equal(initialCursor(list), -1);
  assert.deepEqual(resolveEnter(list, -1, null), { type: "none" });
  // The actions are still there, one ↓ away.
  assert.ok(list.some((option) => option.kind === "write"));
});

test("a matching view is what ↵ acts on, even with writes in the list", () => {
  const list = options("queue");
  const cursor = initialCursor(list);
  assert.deepEqual(resolveEnter(list, cursor, null), { type: "navigate", view: "queue" });
});

test("filing is two steps: the first activation only stages a confirm", () => {
  const list = options("thread replies render blank");
  const write = list.find((option) => option.id === "issue:togathernyc/togather");
  assert.ok(write !== undefined && write.kind === "write");

  const index = list.indexOf(write);
  const staged = resolveEnter(list, index, null);
  assert.equal(staged.type, "stage");
  assert.ok(staged.type === "stage" && staged.option === write);

  // Only with something already staged can ↵ mean "write".
  const committed = resolveEnter(list, index, write);
  assert.equal(committed.type, "commit");
  assert.ok(committed.type === "commit" && committed.write.repoSlug === "togathernyc/togather");
});

test("the confirm row can state the repo and the labels before anything is sent", () => {
  const list = options("thread replies render blank");
  const write = list.find((option) => option.id === "dump");
  assert.ok(write !== undefined && write.kind === "write");
  assert.deepEqual(write.write.labels, ["inbox:raw"]);
  assert.equal(describeWrite(write.write), "togathernyc/togather · inbox:raw");
  assert.equal(write.write.thenNavigate, "inbox");
});

test("writes only exist once something has been typed", () => {
  assert.equal(
    options("").filter((option) => option.kind === "write").length,
    0,
    "an empty palette offers no writes at all",
  );
  assert.equal(options("").filter((option) => option.kind === "nav").length, VIEWS.length);
});

test("nav entries filter on the query; writes are built from it and must not", () => {
  const list = options("Inbox");
  assert.deepEqual(
    list.filter((option) => option.kind === "nav").map((option) => option.id),
    ["nav:inbox"],
  );
  assert.equal(list.filter((option) => option.kind === "write").length, REPOS.length + 1);
});

test("a pasted paragraph becomes a one-line title and a full body", () => {
  const text = `${"x".repeat(200)}\nsecond line`;
  assert.equal(issueTitle(text).length, 70);
  assert.ok(issueTitle(text).endsWith("…"));
  assert.equal(issueTitle("short one\nrest"), "short one");

  const write = options(text).find((option) => option.id === "dump");
  assert.ok(write !== undefined && write.kind === "write");
  assert.equal(write.write.body, text.trim());
});
