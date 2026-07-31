import assert from "node:assert/strict";
import { test } from "node:test";

import { groupByInitiative, initiativeFromBranch, MISC_INITIATIVE } from "../src/lib/initiative";

test("an initiative is everything before the last branch segment", () => {
  assert.equal(initiativeFromBranch("wa-parity/chat-polish"), "wa-parity");
  assert.equal(initiativeFromBranch("claude/devbug-x97d9e1jhgrb9wvk3828vvee9h8awz2c"), "claude");
  // Only the LAST segment is dropped — feat/finance and feat/people are
  // different initiatives that share a `feat/` convention.
  assert.equal(initiativeFromBranch("feat/finance/v2-split"), "feat/finance");
});

test("branches with no prefix fall into misc", () => {
  assert.equal(initiativeFromBranch("main"), MISC_INITIATIVE);
  assert.equal(initiativeFromBranch("hotfix"), MISC_INITIATIVE);
  assert.equal(initiativeFromBranch(""), MISC_INITIATIVE);
  assert.equal(initiativeFromBranch("   "), MISC_INITIATIVE);
  // A leading slash is not a prefix.
  assert.equal(initiativeFromBranch("/solo"), MISC_INITIATIVE);
});

test("empty segments collapse rather than producing a blank initiative", () => {
  assert.equal(initiativeFromBranch("wa-parity//chat-polish"), "wa-parity");
  assert.equal(initiativeFromBranch("wa-parity/chat-polish/"), "wa-parity");
});

test("grouping keeps initiatives alphabetical and sinks misc to the bottom", () => {
  const branches = ["main", "wa-parity/a", "claude/b", "wa-parity/c", "release"];
  const groups = groupByInitiative(branches, initiativeFromBranch);

  assert.deepEqual(
    groups.map((group) => group.name),
    ["claude", "wa-parity", MISC_INITIATIVE],
  );
  assert.deepEqual(groups[1]?.items, ["wa-parity/a", "wa-parity/c"]);
  assert.deepEqual(groups[2]?.items, ["main", "release"]);
});
