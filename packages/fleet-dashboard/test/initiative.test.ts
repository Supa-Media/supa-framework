import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONVENTIONAL_PREFIXES,
  groupByInitiative,
  HARNESS_PREFIXES,
  initiativeFromBranch,
  isNoisyInitiative,
  MISC_INITIATIVE,
} from "../src/lib/initiative";

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

test("every conventional-commit prefix is noise, and so is misc itself", () => {
  for (const prefix of CONVENTIONAL_PREFIXES) {
    assert.equal(isNoisyInitiative(prefix), true, prefix);
  }
  assert.equal(isNoisyInitiative(MISC_INITIATIVE), true);
  assert.equal(isNoisyInitiative(""), true);
  // Case-insensitive: a branch is `Fix/…` as easily as `fix/…`.
  assert.equal(isNoisyInitiative("FEAT"), true);
  assert.equal(isNoisyInitiative("Chore"), true);
});

test("a conventional prefix is noise only when it is the whole key", () => {
  // `feat` names nothing. `feat/finance` names finance — and the manifest may
  // well carry an entry for it, so collapsing both would throw that away.
  assert.equal(isNoisyInitiative("feat"), true);
  assert.equal(isNoisyInitiative("feat/finance"), false);
  assert.equal(isNoisyInitiative("fix/thread-rooting"), false);
});

test("a harness prefix is noise at any depth", () => {
  for (const prefix of HARNESS_PREFIXES) {
    assert.equal(isNoisyInitiative(prefix), true, prefix);
    assert.equal(isNoisyInitiative(`${prefix}/anything`), true, `${prefix}/anything`);
  }
  // The real shapes from the fleet's own branch list.
  assert.equal(isNoisyInitiative("claude"), true);
  assert.equal(isNoisyInitiative("cursor"), true);
  assert.equal(isNoisyInitiative("agents"), true);
  assert.equal(isNoisyInitiative("dependabot/npm_and_yarn"), true);
});

test("a real initiative survives the stoplist", () => {
  for (const name of ["wa-parity", "giving", "finance-v2", "rostering", "org-chart"]) {
    assert.equal(isNoisyInitiative(name), false, name);
  }
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
