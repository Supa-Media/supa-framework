import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeSnapshots } from "../src/sources/merge";
import {
  emptySnapshot,
  type FleetSnapshot,
  type ProjectSnapshot,
  type RunEvent,
} from "../src/sources/types";

/**
 * The merge rule the seam notes in `sources/types.ts` promise: by project key,
 * later source wins scalars, appends lists — plus the refinement that `null`
 * means "I don't know" and must not blank an earlier answer.
 */

function project(overrides: Partial<ProjectSnapshot> & { key: string }): ProjectSnapshot {
  return {
    slug: overrides.key,
    label: overrides.key,
    owner: overrides.key.split("/")[0] ?? "",
    tokenMissing: false,
    searchFailed: false,
    url: `https://github.com/${overrides.key}`,
    defaultBranch: "main",
    activeRuns: 0,
    openPrs: 0,
    fetchedPrs: 0,
    ci: null,
    lastDeploy: null,
    lastProdDeploy: null,
    initiatives: [],
    gardeners: [],
    manifest: { initiatives: [] },
    allowlist: { required: [], optional: [], path: null, error: null },
    secretNames: null,
    ...overrides,
  } as ProjectSnapshot;
}

function snapshot(overrides: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return { ...emptySnapshot(), ...overrides };
}

function runEvent(id: string, at: string): RunEvent {
  return {
    id,
    source: "watchdog",
    repoKey: "a/b",
    issueNumber: null,
    kind: "wake",
    at,
    url: null,
    payload: null,
  };
}

test("no snapshots is the identity", () => {
  assert.deepEqual(mergeSnapshots([]), emptySnapshot());
});

test("one snapshot is returned as-is, untouched", () => {
  const only = snapshot({ fetchedAt: "2026-08-01T00:00:00.000Z" });
  assert.equal(mergeSnapshots([only]), only);
});

test("projects merge by key, and an unknown key is appended", () => {
  const merged = mergeSnapshots([
    snapshot({ projects: [project({ key: "a/b", openPrs: 3 })] }),
    snapshot({ projects: [project({ key: "c/d", openPrs: 1 })] }),
  ]);
  assert.deepEqual(
    merged.projects.map((entry) => entry.key),
    ["a/b", "c/d"],
  );
});

test("the later source wins a scalar", () => {
  const merged = mergeSnapshots([
    snapshot({ projects: [project({ key: "a/b", openPrs: 3, label: "Old" })] }),
    snapshot({ projects: [project({ key: "a/b", openPrs: 5, label: "New" })] }),
  ]);
  assert.equal(merged.projects[0]?.openPrs, 5);
  assert.equal(merged.projects[0]?.label, "New");
});

test("list fields on a project append rather than replace", () => {
  const merged = mergeSnapshots([
    snapshot({
      projects: [project({ key: "a/b", initiatives: [{ name: "giving", prs: [] }] })],
    }),
    snapshot({
      projects: [project({ key: "a/b", initiatives: [{ name: "chat", prs: [] }] })],
    }),
  ]);
  assert.deepEqual(
    merged.projects[0]?.initiatives.map((entry) => entry.name),
    ["giving", "chat"],
  );
});

/**
 * `secretNames: null` means "this token could not see them", which is a
 * different answer from an empty list — and a source that never asked must not
 * overwrite one that did.
 */
test("a later null does not blank an earlier observation", () => {
  const merged = mergeSnapshots([
    snapshot({
      projects: [project({ key: "a/b", secretNames: ["TOKEN"] })],
      spendReportedUsd: 12,
      spendReportedAt: "2026-08-01T00:00:00.000Z",
      rateLimit: {
        remaining: 10,
        limit: 5000,
        resetAt: "2026-08-01T01:00:00.000Z",
        owner: "Supa-Media",
      },
    }),
    snapshot({ projects: [project({ key: "a/b" })] }),
  ]);
  assert.deepEqual(merged.projects[0]?.secretNames, ["TOKEN"]);
  assert.equal(merged.spendReportedUsd, 12);
  assert.equal(merged.rateLimit?.remaining, 10);
});

test("a later value does replace an earlier one, including a smaller number", () => {
  const merged = mergeSnapshots([
    snapshot({ spendReportedUsd: 12 }),
    snapshot({ spendReportedUsd: 3 }),
  ]);
  assert.equal(merged.spendReportedUsd, 3);
});

test("top-level lists concatenate and de-duplicate by id, later content winning", () => {
  const merged = mergeSnapshots([
    snapshot({ runEvents: [runEvent("one", "2026-08-01T00:00:00.000Z")] }),
    snapshot({
      runEvents: [
        { ...runEvent("one", "2026-08-01T00:00:00.000Z"), kind: "respawn" },
        runEvent("two", "2026-08-02T00:00:00.000Z"),
      ],
    }),
  ]);
  assert.equal(merged.runEvents.length, 2);
  assert.equal(merged.runEvents.find((event) => event.id === "one")?.kind, "respawn");
});

test("merged run events are newest first", () => {
  const merged = mergeSnapshots([
    snapshot({ runEvents: [runEvent("old", "2026-07-30T00:00:00.000Z")] }),
    snapshot({ runEvents: [runEvent("new", "2026-08-02T00:00:00.000Z")] }),
  ]);
  assert.deepEqual(
    merged.runEvents.map((event) => event.id),
    ["new", "old"],
  );
});

/** Two sources failing on the same repo is two things to fix. */
test("errors concatenate and never dedupe", () => {
  const merged = mergeSnapshots([
    snapshot({ errors: [{ scope: "a/b", message: "boom" }] }),
    snapshot({ errors: [{ scope: "a/b", message: "boom" }] }),
  ]);
  assert.equal(merged.errors.length, 2);
});

test("fetchedAt is the newest observation, not the last one to answer", () => {
  const merged = mergeSnapshots([
    snapshot({ fetchedAt: "2026-08-01T10:00:00.000Z" }),
    snapshot({ fetchedAt: "2026-08-01T09:00:00.000Z" }),
  ]);
  assert.equal(merged.fetchedAt, "2026-08-01T10:00:00.000Z");
});

test("merging a GitHub snapshot with an empty Convex one changes nothing but is safe", () => {
  const github = snapshot({
    projects: [project({ key: "a/b", openPrs: 4 })],
    spendReportedUsd: 9,
  });
  const merged = mergeSnapshots([github, snapshot()]);
  assert.equal(merged.projects[0]?.openPrs, 4);
  assert.equal(merged.spendReportedUsd, 9);
  assert.deepEqual(merged.runEvents, []);
});
