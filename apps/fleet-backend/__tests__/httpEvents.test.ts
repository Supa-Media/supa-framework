import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import schema from "../convex/schema";
import { computeHmacHex, signingString } from "../convex/lib/auth";
import { MAX_BODY_BYTES } from "../convex/lib/parseEvents";
import { modules } from "../test.setup";

/**
 * The ingest and read routes end to end: signature check, parse, insert, and
 * the windowed read the dashboard actually makes.
 */

const SECRET = "test-backend-secret";
const READ_TOKEN = "test-read-token";

beforeEach(() => {
  process.env.FLEET_BACKEND_SECRET = SECRET;
  process.env.FLEET_READ_TOKEN = READ_TOKEN;
});

afterEach(() => {
  delete process.env.FLEET_BACKEND_SECRET;
  delete process.env.FLEET_READ_TOKEN;
});

async function post(
  t: ReturnType<typeof convexTest>,
  body: unknown,
  options: { secret?: string; timestamp?: number } = {},
): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = String(options.timestamp ?? Date.now());
  const signature = await computeHmacHex(
    options.secret ?? SECRET,
    signingString(timestamp, raw),
  );
  return t.fetch("/fleet/events", {
    method: "POST",
    body: raw,
    headers: { "x-fleet-timestamp": timestamp, "x-fleet-signature": signature },
  });
}

function read(t: ReturnType<typeof convexTest>, query = "", token = READ_TOKEN): Promise<Response> {
  return t.fetch(`/fleet/events${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

const WAKE = { source: "watchdog", repo: "Supa-Media/events-os", kind: "wake" };

describe("POST /fleet/events", () => {
  test("a signed event is accepted and readable back", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, { ...WAKE, issueNumber: 7, payload: { respawns: 1 } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ inserted: 1, deduped: 0 });

    const listed = await (await read(t)).json();
    expect(listed.events).toHaveLength(1);
    expect(listed.events[0]).toMatchObject({
      source: "watchdog",
      repo: "supa-media/events-os",
      kind: "wake",
      issueNumber: 7,
      payload: { respawns: 1 },
    });
    expect(listed.events[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("a batch inserts every event", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, {
      events: [WAKE, { ...WAKE, kind: "respawn" }, { ...WAKE, source: "decider", kind: "decision" }],
    });
    expect(await response.json()).toEqual({ inserted: 3, deduped: 0 });
  });

  test("an unsigned request is rejected", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/fleet/events", { method: "POST", body: JSON.stringify(WAKE) });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("Missing");
  });

  test("the read token cannot write telemetry", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/fleet/events", {
      method: "POST",
      body: JSON.stringify(WAKE),
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    });
    expect(response.status).toBe(401);
  });

  test("a wrong secret is rejected", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, WAKE, { secret: "wrong" });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Invalid signature");
  });

  test("a replayed capture outside the window is rejected", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, WAKE, { timestamp: Date.now() - 10 * 60 * 1000 });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("outside the accepted window");
  });

  test("503s when the backend secret is not configured", async () => {
    delete process.env.FLEET_BACKEND_SECRET;
    const t = convexTest(schema, modules);
    const response = await post(t, WAKE);
    expect(response.status).toBe(503);
  });

  test("signed but malformed is a 400 naming the field, not a row of undefineds", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, { ...WAKE, source: "cron" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("source must be one of");

    const listed = await (await read(t)).json();
    expect(listed.events).toHaveLength(0);
  });

  test("signed but unparseable JSON is a 400", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, "{not json");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Body is not valid JSON");
  });

  test("an oversized body is refused before it is parsed", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, { ...WAKE, payload: { blob: "x".repeat(MAX_BODY_BYTES) } });
    expect(response.status).toBe(413);
  });

  test("a dedupeKey makes a retry at-most-once", async () => {
    const t = convexTest(schema, modules);
    const event = { ...WAKE, dedupeKey: "watchdog-run-91" };
    expect(await (await post(t, event)).json()).toEqual({ inserted: 1, deduped: 0 });
    expect(await (await post(t, event)).json()).toEqual({ inserted: 0, deduped: 1 });

    const listed = await (await read(t)).json();
    expect(listed.events).toHaveLength(1);
  });

  test("without a dedupeKey, a repeat appends — the log is append-only by default", async () => {
    const t = convexTest(schema, modules);
    await post(t, WAKE);
    await post(t, WAKE);
    const listed = await (await read(t)).json();
    expect(listed.events).toHaveLength(2);
  });

  /** The second lookup sees the first insert in-transaction. Easy to get wrong. */
  test("two identical dedupeKeys inside one batch dedupe against each other", async () => {
    const t = convexTest(schema, modules);
    const event = { ...WAKE, dedupeKey: "watchdog-run-91" };
    const response = await post(t, { events: [event, event] });
    expect(await response.json()).toEqual({ inserted: 1, deduped: 1 });
    expect((await (await read(t)).json()).events).toHaveLength(1);
  });

  /**
   * A future `at` is refused rather than clamped.
   *
   * `by_at` is read newest-first, so a year-3000 row sorts above everything in
   * every window forever and no `since` can exclude it — one panel permanently
   * wrong because one shell script emitted nanoseconds.
   */
  test("a year-3000 event is refused, so it cannot pin every window", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, { ...WAKE, kind: "year-3000", at: 32_500_000_000_000 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("not in the future");

    await post(t, WAKE);
    const listed = await (await read(t)).json();
    expect(listed.events.map((event: { kind: string }) => event.kind)).toEqual(["wake"]);
  });

  test("a batch is refused whole when one event is future-dated", async () => {
    const t = convexTest(schema, modules);
    const response = await post(t, {
      events: [WAKE, { ...WAKE, at: Date.now() + 365 * 24 * 60 * 60 * 1000 }],
    });
    expect(response.status).toBe(400);
    expect((await (await read(t)).json()).events).toHaveLength(0);
  });

  test("an `at` inside the accepted skew is fine — a CI clock may run a little fast", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, { ...WAKE, at: Date.now() + 60_000 })).status).toBe(202);
  });

  test("a past `at` needs no ceiling — it simply ages out of the window", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, { ...WAKE, kind: "ancient", at: 0 })).status).toBe(202);
    expect((await (await read(t)).json()).events).toHaveLength(0);
  });
});

describe("GET /fleet/events", () => {
  async function seed(t: ReturnType<typeof convexTest>): Promise<void> {
    const now = Date.now();
    await post(t, {
      events: [
        { ...WAKE, kind: "recent", at: now - 60_000 },
        { ...WAKE, kind: "older", at: now - 6 * 60 * 60 * 1000 },
        { ...WAKE, kind: "ancient", at: now - 40 * 24 * 60 * 60 * 1000 },
        { source: "gardener", repo: "togathernyc/togather", kind: "triage", at: now - 30_000 },
      ],
    });
  }

  test("requires the read token", async () => {
    const t = convexTest(schema, modules);
    expect((await t.fetch("/fleet/events", { method: "GET" })).status).toBe(401);
    expect((await read(t, "", "wrong-token")).status).toBe(401);
  });

  test("503s when the read token is not configured", async () => {
    delete process.env.FLEET_READ_TOKEN;
    const t = convexTest(schema, modules);
    expect((await read(t)).status).toBe(503);
  });

  test("defaults to the last 24 hours, newest first", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const listed = await (await read(t)).json();
    expect(listed.events.map((event: { kind: string }) => event.kind)).toEqual([
      "triage",
      "recent",
      "older",
    ]);
  });

  test("`since` widens the window, and is reported back as ISO", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const listed = await (await read(t, `?since=${encodeURIComponent(since)}`)).json();
    expect(listed.events.map((event: { kind: string }) => event.kind)).toEqual(["triage", "recent"]);
    expect(listed.since).toBe(since);
  });

  test("a `since` beyond the ceiling is clamped rather than refused", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const listed = await (await read(t, "?since=0")).json();
    // The 40-day-old event stays out: the window floor is 30 days.
    expect(listed.events.map((event: { kind: string }) => event.kind)).not.toContain("ancient");
    expect(Date.parse(listed.since)).toBeGreaterThan(0);
  });

  test("filters by repo and by source", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const byRepo = await (await read(t, "?repo=togathernyc/togather")).json();
    expect(byRepo.events.map((event: { kind: string }) => event.kind)).toEqual(["triage"]);

    const bySource = await (await read(t, "?source=gardener")).json();
    expect(bySource.events.map((event: { kind: string }) => event.kind)).toEqual(["triage"]);
  });

  test("the repo filter is case-insensitive, matching how repos are stored", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const listed = await (await read(t, "?repo=TogatherNYC/Togather")).json();
    expect(listed.events).toHaveLength(1);
  });

  test("rejects an unknown source and an unparseable since", async () => {
    const t = convexTest(schema, modules);
    expect((await read(t, "?source=cron")).status).toBe(400);
    expect((await read(t, "?since=lunchtime")).status).toBe(400);
    expect((await read(t, "?limit=lots")).status).toBe(400);
  });

  test("limit caps the page and reports the cut", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const listed = await (await read(t, "?limit=2")).json();
    expect(listed.events).toHaveLength(2);
    expect(listed.truncated).toBe(true);

    const whole = await (await read(t, "?limit=500")).json();
    expect(whole.truncated).toBe(false);
  });

  /** The clamp arithmetic, asserted exactly rather than approximately. */
  test("the window floor is exactly 30 days, however absurd the `since`", async () => {
    const t = convexTest(schema, modules);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    for (const since of ["0", "-99999999999999"]) {
      const before = Date.now();
      const listed = await (await read(t, `?since=${since}`)).json();
      const after = Date.now();
      expect(Date.parse(listed.since)).toBeGreaterThanOrEqual(before - thirtyDays);
      expect(Date.parse(listed.since)).toBeLessThanOrEqual(after - thirtyDays);
    }
  });

  test("the default window is exactly 24 hours", async () => {
    const t = convexTest(schema, modules);
    const before = Date.now();
    const listed = await (await read(t)).json();
    const after = Date.now();
    expect(Date.parse(listed.since)).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000);
    expect(Date.parse(listed.since)).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000);
  });

  test("a `since` in the future is empty, which is honest rather than an error", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const listed = await (await read(t, `?since=${Date.now() + 365 * 24 * 60 * 60 * 1000}`)).json();
    expect(listed.events).toEqual([]);
    expect(listed.truncated).toBe(false);
  });

  test("limit floors at 1, caps at 500, and truncates a fraction", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    for (const limit of ["0", "-5"]) {
      expect((await (await read(t, `?limit=${limit}`)).json()).events).toHaveLength(1);
    }
    expect((await (await read(t, "?limit=2.9")).json()).events).toHaveLength(2);
    // 99999 is accepted and silently capped; with 3 rows in window it simply
    // returns all of them, which is the observable half of the cap.
    const capped = await (await read(t, "?limit=99999")).json();
    expect(capped.events).toHaveLength(3);
    expect(capped.truncated).toBe(false);
  });

  test("`truncated` is exact at the boundary, not guessed from a full page", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect((await (await read(t, "?limit=2")).json()).truncated).toBe(true);
    // Three rows fall inside the default 24h window; asking for exactly three
    // is a full page that is nonetheless complete.
    expect((await (await read(t, "?limit=3")).json()).truncated).toBe(false);
  });
});

/**
 * A rejected request must say the same thing whether or not there is anything
 * to hide — otherwise the 401 itself becomes a read.
 */
describe("no existence leak", () => {
  test("bad-auth responses are byte-identical on an empty and a populated backend", async () => {
    const empty = convexTest(schema, modules);
    const populated = convexTest(schema, modules);
    await post(populated, WAKE);
    await populated.fetch("/fleet/review", {
      method: "POST",
      body: JSON.stringify({ lastReviewedAt: "2026-08-01T07:00:00.000Z", device: "Mac" }),
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    });

    for (const path of ["/fleet/events", "/fleet/review"]) {
      const a = await empty.fetch(path, {
        method: "GET",
        headers: { Authorization: "Bearer wrong" },
      });
      const b = await populated.fetch(path, {
        method: "GET",
        headers: { Authorization: "Bearer wrong" },
      });
      expect(a.status).toBe(b.status);
      expect(await a.text()).toBe(await b.text());
    }
  });

  test("an error body never echoes the credential it was compared against", async () => {
    const t = convexTest(schema, modules);
    const body = await (await read(t, "", "wrong-token")).text();
    expect(body).not.toContain(READ_TOKEN);
    expect(body).not.toContain("wrong-token");
  });
});

describe("CORS and health", () => {
  test("preflight is answered for every /fleet/ route", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/fleet/events", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("x-fleet-signature");
  });

  test("health needs no credential and says nothing else", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/fleet/health", { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("a rejection carries CORS headers, so the browser can read the reason", async () => {
    const t = convexTest(schema, modules);
    const response = await read(t, "", "wrong-token");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
