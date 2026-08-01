import assert from "node:assert/strict";
import { test } from "node:test";

import { fleetConfig } from "../src/fleet.config";
import {
  clearTokens,
  fleetOwners,
  hasAnyToken,
  loadTokens,
  LEGACY_TOKEN_KEY,
  mergeTokens,
  ownerOf,
  ownersMissingToken,
  repoName,
  saveTokens,
  tokenForRepo,
  TOKENS_KEY,
  type TokenStore,
} from "../src/lib/tokens";

/**
 * Token routing and the v2 → v3 migration.
 *
 * A fine-grained GitHub PAT is scoped to exactly one resource owner and this
 * fleet spans three, so "the token" was never a thing that could exist. These
 * tests pin the two places that gets decided: which token a repo's request is
 * signed with, and what happens to the single token v2 already left in
 * someone's browser.
 */

/** An in-memory `localStorage` — the module takes the store as a parameter. */
function store(initial: Record<string, string> = {}): TokenStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const OWNERS = ["togathernyc", "Supa-Media", "shyoh"];

test("the fleet's owners are derived from the slugs, with the repos each covers", () => {
  const groups = fleetOwners(fleetConfig.repos);

  assert.deepEqual(
    groups.map((group) => group.owner),
    OWNERS,
    "three owners, in config order — this is why one token cannot do it",
  );
  assert.deepEqual(
    groups.map((group) => group.repos.map((repo) => repoName(repo.slug))),
    [["togather"], ["events-os", "supa-framework"], ["fount-studios"]],
  );
  assert.equal(ownerOf("Supa-Media/events-os"), "Supa-Media");
  assert.throws(() => ownerOf("events-os"), /not an owner\/name repo slug/);
});

test("a request is signed with the token for its repo's owner", () => {
  const tokens = { togathernyc: "a", "Supa-Media": "b", shyoh: "c" };

  assert.equal(tokenForRepo(tokens, "togathernyc/togather"), "a");
  assert.equal(tokenForRepo(tokens, "Supa-Media/events-os"), "b");
  assert.equal(tokenForRepo(tokens, "Supa-Media/supa-framework"), "b");
  assert.equal(tokenForRepo(tokens, "shyoh/fount-studios"), "c");
});

test("owner casing never changes which token is picked", () => {
  // GitHub logins are case-insensitive; a map typed by hand must not silently
  // miss the repo whose config spells the owner differently.
  assert.equal(tokenForRepo({ "supa-media": "b" }, "Supa-Media/events-os"), "b");
  assert.equal(tokenForRepo({ "SUPA-MEDIA": "b" }, "Supa-Media/events-os"), "b");
});

test("only the owners with no token are named as missing", () => {
  assert.deepEqual(ownersMissingToken({ "Supa-Media": "b" }, fleetConfig.repos), [
    "togathernyc",
    "shyoh",
  ]);
  assert.deepEqual(
    ownersMissingToken({ togathernyc: "a", "Supa-Media": "b", shyoh: "c" }, fleetConfig.repos),
    [],
  );
  // One token is enough to sign in — partial is a supported state, not an error.
  assert.equal(hasAnyToken({ "Supa-Media": "b" }), true);
  assert.equal(hasAnyToken({}), false);
});

test("v2's single token is applied to every owner, once, and then deleted", () => {
  const storage = store({ [LEGACY_TOKEN_KEY]: "github_pat_old" });

  const first = loadTokens(OWNERS, storage);
  assert.deepEqual(first, {
    togathernyc: "github_pat_old",
    "Supa-Media": "github_pat_old",
    shyoh: "github_pat_old",
  });
  assert.equal(storage.data.has(LEGACY_TOKEN_KEY), false, "the old key must not survive");

  // The delete is what makes it once: a second load reads the map and does
  // nothing else, so replacing one owner's token afterwards is not undone on
  // the next page load.
  saveTokens({ ...first, "Supa-Media": "github_pat_new" }, storage);
  assert.deepEqual(loadTokens(OWNERS, storage), {
    togathernyc: "github_pat_old",
    "Supa-Media": "github_pat_new",
    shyoh: "github_pat_old",
  });
});

test("the migration never overwrites a token already in the map", () => {
  const storage = store({
    [TOKENS_KEY]: JSON.stringify({ "Supa-Media": "kept" }),
    [LEGACY_TOKEN_KEY]: "legacy",
  });

  assert.deepEqual(loadTokens(OWNERS, storage), {
    "Supa-Media": "kept",
    togathernyc: "legacy",
    shyoh: "legacy",
  });
});

test("an unreadable or non-object token map loads as signed out, never as junk", () => {
  assert.deepEqual(loadTokens(OWNERS, store({ [TOKENS_KEY]: "not json" })), {});
  assert.deepEqual(loadTokens(OWNERS, store({ [TOKENS_KEY]: '["a","b"]' })), {});
  // A blank value is absence, not a token that will 401 on every request.
  assert.deepEqual(loadTokens(OWNERS, store({ [TOKENS_KEY]: '{"shyoh":"   "}' })), {});
  assert.deepEqual(loadTokens(OWNERS, null), {}, "storage disabled is signed out, not a crash");
});

test("a blank field keeps the saved token; a filled one replaces it", () => {
  // The gate is reachable mid-session, so its common visit is "one PAT expired,
  // replace that one". Requiring the other two to be re-pasted to avoid losing
  // them would be a trap dressed as a form.
  const merged = mergeTokens(
    { togathernyc: "a", "Supa-Media": "b", shyoh: "c" },
    { togathernyc: "", "Supa-Media": "  b2  ", shyoh: "   " },
  );
  assert.deepEqual(merged, { togathernyc: "a", "Supa-Media": "b2", shyoh: "c" });
});

test("sign out forgets every token, including a legacy key that never migrated", () => {
  // "Sign out" that left two of three tokens in localStorage would be a lie
  // with a reassuring label on it.
  const storage = store({
    [TOKENS_KEY]: JSON.stringify({ togathernyc: "a", shyoh: "c" }),
    [LEGACY_TOKEN_KEY]: "legacy",
  });

  clearTokens(storage);

  assert.equal(storage.data.size, 0);
  assert.deepEqual(loadTokens(OWNERS, storage), {});
});
