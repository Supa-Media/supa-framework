import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { BackendConfig } from "../src/lib/backend";
import { createConvexSource } from "../src/sources/convex/convexSource";
import { createConvexReviewStore } from "../src/sources/convex/reviewStore";

/**
 * The Convex source's contract, which is mostly a contract about failing.
 *
 * Seam rule 2 (`sources/types.ts`): a source must not throw for a partial
 * failure. The dashboard is a status board and a dead backend must cost a named
 * line in the banner, never the page.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const BACKEND: BackendConfig = { url: "https://fleet.convex.site", readToken: "read-token" };
const SINCE = "2026-08-01T00:00:00.000Z";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** Stub `fetch` and record what it was asked for. */
function stubFetch(responder: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return calls;
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const EVENT = {
  id: "row-1",
  source: "watchdog",
  repo: "Supa-Media/events-os",
  kind: "respawn",
  at: "2026-08-01T03:12:00.000Z",
  url: "https://github.com/Supa-Media/events-os/actions/runs/1",
  payload: { respawns: 2 },
};

test("reads the window and returns run events, lowercasing the repo key", async () => {
  const calls = stubFetch(() => ok({ events: [EVENT], since: SINCE, truncated: false }));
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });

  assert.equal(snapshot.runEvents.length, 1);
  assert.deepEqual(snapshot.runEvents[0], {
    id: "row-1",
    source: "watchdog",
    repoKey: "supa-media/events-os",
    issueNumber: null,
    kind: "respawn",
    at: "2026-08-01T03:12:00.000Z",
    url: "https://github.com/Supa-Media/events-os/actions/runs/1",
    payload: { respawns: 2 },
  });
  assert.equal(snapshot.errors.length, 0);

  const call = calls[0];
  assert.ok(call !== undefined);
  assert.ok(call.url.startsWith("https://fleet.convex.site/fleet/events?"));
  assert.ok(call.url.includes(`since=${encodeURIComponent(SINCE)}`));
  assert.equal(new Headers(call.init?.headers).get("Authorization"), "Bearer read-token");
});

test("contributes nothing but run events — GitHub stays the source of truth", async () => {
  stubFetch(() => ok({ events: [EVENT] }));
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.deepEqual(snapshot.projects, []);
  assert.deepEqual(snapshot.issues, []);
  assert.deepEqual(snapshot.needsYou, []);
  assert.deepEqual(snapshot.shipped, []);
  assert.equal(snapshot.spendReportedUsd, null);
});

test("a rejected token is a named SourceError, not a throw", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ error: "Invalid read token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.deepEqual(snapshot.runEvents, []);
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.errors[0]?.scope, "convex");
  assert.match(snapshot.errors[0]?.message ?? "", /read token/);
});

test("an unreachable backend is a SourceError, not a throw", async () => {
  stubFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.equal(snapshot.errors.length, 1);
  assert.match(snapshot.errors[0]?.message ?? "", /Failed to fetch/);
});

test("a 503 reports what the backend said, so the fix is naming an env var", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ error: "FLEET_READ_TOKEN is not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.match(snapshot.errors[0]?.message ?? "", /FLEET_READ_TOKEN/);
});

test("a non-JSON failure still yields a readable message", async () => {
  stubFetch(() => new Response("<html>502</html>", { status: 502 }));
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.match(snapshot.errors[0]?.message ?? "", /HTTP 502/);
});

/**
 * An abort is the dashboard superseding its own request. Reporting it would put
 * a scary line on screen about a backend that is perfectly healthy.
 */
test("an aborted fetch reports nothing at all", async () => {
  stubFetch(() => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  });
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.deepEqual(snapshot.errors, []);
  assert.deepEqual(snapshot.runEvents, []);
});

test("malformed rows are dropped, the rest of the page survives", async () => {
  stubFetch(() =>
    ok({
      events: [
        EVENT,
        { ...EVENT, id: "row-2", source: "cron" },
        { ...EVENT, id: "row-3", repo: "" },
        { ...EVENT, id: "row-4", at: "not a date" },
        { ...EVENT, id: "row-5", kind: "" },
        { ...EVENT, id: 7 },
        "a string",
        null,
      ],
    }),
  );
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.deepEqual(
    snapshot.runEvents.map((event) => event.id),
    ["row-1"],
  );
});

test("a payload that is not an object, and a non-http url, are dropped rather than rendered", async () => {
  stubFetch(() =>
    ok({ events: [{ ...EVENT, url: "javascript:alert(1)", payload: ["not", "an", "object"] }] }),
  );
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.equal(snapshot.runEvents[0]?.url, null);
  assert.equal(snapshot.runEvents[0]?.payload, null);
});

test("a body with no events array is empty, not an error", async () => {
  stubFetch(() => ok({ nope: true }));
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.deepEqual(snapshot.runEvents, []);
  assert.deepEqual(snapshot.errors, []);
});

test("events come back newest first regardless of the order sent", async () => {
  stubFetch(() =>
    ok({
      events: [
        { ...EVENT, id: "old", at: "2026-07-30T00:00:00.000Z" },
        { ...EVENT, id: "new", at: "2026-08-01T00:00:00.000Z" },
      ],
    }),
  );
  const snapshot = await createConvexSource(BACKEND).fetchFleet({ since: SINCE });
  assert.deepEqual(
    snapshot.runEvents.map((event) => event.id),
    ["new", "old"],
  );
});

test("the review store reads a mark, and reads its absence as null", async () => {
  stubFetch(() =>
    ok({ state: { lastReviewedAt: SINCE, updatedAt: 1000, device: "Mac", prefs: {} } }),
  );
  const outcome = await createConvexReviewStore(BACKEND).read();
  assert.deepEqual(outcome, {
    ok: true,
    mark: { lastReviewedAt: SINCE, updatedAt: 1000, device: "Mac" },
  });

  stubFetch(() => ok({ state: null }));
  assert.deepEqual(await createConvexReviewStore(BACKEND).read(), { ok: true, mark: null });
});

test("the review store distinguishes 'no mark yet' from 'could not reach it'", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ error: "Invalid read token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const outcome = await createConvexReviewStore(BACKEND).read();
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? "" : outcome.message, /read token/);
});

test("the review store POSTs the mark and believes the state it gets back", async () => {
  const calls = stubFetch(() =>
    ok({
      applied: false,
      state: { lastReviewedAt: "2026-08-01T19:00:00.000Z", updatedAt: 9000, device: "iPhone" },
    }),
  );
  const outcome = await createConvexReviewStore(BACKEND).write({
    lastReviewedAt: SINCE,
    updatedAt: 1000,
    device: "Mac",
  });

  assert.deepEqual(outcome, {
    ok: true,
    mark: { lastReviewedAt: "2026-08-01T19:00:00.000Z", updatedAt: 9000, device: "iPhone" },
  });

  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.init?.method, "POST");
  assert.equal(call.url, "https://fleet.convex.site/fleet/review");
  assert.deepEqual(JSON.parse(String(call.init?.body)), {
    lastReviewedAt: SINCE,
    updatedAt: 1000,
    device: "Mac",
  });
});

test("a failed write is reported rather than thrown, so the local mark stands", async () => {
  stubFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  const outcome = await createConvexReviewStore(BACKEND).write({
    lastReviewedAt: SINCE,
    updatedAt: 1000,
    device: "Mac",
  });
  assert.equal(outcome.ok, false);
});
