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
