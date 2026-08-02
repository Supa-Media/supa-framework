import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import schema from "../convex/schema";
import { modules } from "../test.setup";

/**
 * The cross-device marker: two browsers, one answer, and the rule that decides
 * which of them is right when they disagree.
 */

const READ_TOKEN = "test-read-token";
const MORNING = "2026-08-01T07:00:00.000Z";
const EVENING = "2026-08-01T19:00:00.000Z";

beforeEach(() => {
  process.env.FLEET_READ_TOKEN = READ_TOKEN;
  process.env.FLEET_BACKEND_SECRET = "test-backend-secret";
});

afterEach(() => {
  delete process.env.FLEET_READ_TOKEN;
  delete process.env.FLEET_BACKEND_SECRET;
});

function get(t: ReturnType<typeof convexTest>, token = READ_TOKEN): Promise<Response> {
  return t.fetch("/fleet/review", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
}

function put(
  t: ReturnType<typeof convexTest>,
  body: unknown,
  token = READ_TOKEN,
): Promise<Response> {
  return t.fetch("/fleet/review", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

describe("GET /fleet/review", () => {
  test("a fresh backend answers null rather than inventing a marker", async () => {
    const t = convexTest(schema, modules);
    const response = await get(t);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: null });
  });

  test("requires the read token", async () => {
    const t = convexTest(schema, modules);
    expect((await t.fetch("/fleet/review", { method: "GET" })).status).toBe(401);
    expect((await get(t, "wrong")).status).toBe(401);
  });

  test("503s when the read token is not configured", async () => {
    delete process.env.FLEET_READ_TOKEN;
    const t = convexTest(schema, modules);
    expect((await get(t)).status).toBe(503);
  });
});

describe("POST /fleet/review", () => {
  test("stores the marker and reads it back", async () => {
    const t = convexTest(schema, modules);
    const response = await put(t, { lastReviewedAt: MORNING, updatedAt: 1000, device: "MacBook" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      applied: true,
      state: { lastReviewedAt: MORNING, updatedAt: 1000, device: "MacBook", prefs: {} },
    });

    expect((await (await get(t)).json()).state).toMatchObject({ lastReviewedAt: MORNING });
  });

  test("requires the read token", async () => {
    const t = convexTest(schema, modules);
    expect(
      (await t.fetch("/fleet/review", { method: "POST", body: JSON.stringify({}) })).status,
    ).toBe(401);
    expect((await put(t, { lastReviewedAt: MORNING }, "wrong")).status).toBe(401);
  });

  test("a newer write wins", async () => {
    const t = convexTest(schema, modules);
    await put(t, { lastReviewedAt: MORNING, updatedAt: 1000, device: "iPhone" });
    const response = await put(t, { lastReviewedAt: EVENING, updatedAt: 2000, device: "MacBook" });
    expect(await response.json()).toMatchObject({
      applied: true,
      state: { lastReviewedAt: EVENING, device: "MacBook" },
    });
  });

  /**
   * The phone that marked reviewed at 07:00 while offline must not overwrite the
   * laptop's genuine 08:00 mark when it finally syncs.
   */
  test("a late-arriving older write is ignored and says so", async () => {
    const t = convexTest(schema, modules);
    await put(t, { lastReviewedAt: EVENING, updatedAt: 2000, device: "MacBook" });
    const response = await put(t, { lastReviewedAt: MORNING, updatedAt: 1000, device: "iPhone" });
    expect(await response.json()).toEqual({
      applied: false,
      state: { lastReviewedAt: EVENING, updatedAt: 2000, device: "MacBook", prefs: {} },
    });
  });

  test("an equal timestamp keeps the stored row, so a retry is not a change", async () => {
    const t = convexTest(schema, modules);
    await put(t, { lastReviewedAt: EVENING, updatedAt: 2000, device: "MacBook" });
    const response = await put(t, { lastReviewedAt: MORNING, updatedAt: 2000, device: "iPhone" });
    expect(await response.json()).toMatchObject({
      applied: false,
      state: { lastReviewedAt: EVENING, device: "MacBook" },
    });
  });

  test("prefs merge key-by-key — an old device must not delete a key it never knew", async () => {
    const t = convexTest(schema, modules);
    await put(t, {
      lastReviewedAt: MORNING,
      updatedAt: 1000,
      device: "MacBook",
      prefs: { density: "compact", sound: "off" },
    });
    const response = await put(t, {
      lastReviewedAt: EVENING,
      updatedAt: 2000,
      device: "iPhone",
      prefs: { density: "roomy" },
    });
    expect((await response.json()).state.prefs).toEqual({ density: "roomy", sound: "off" });
  });

  test("updatedAt defaults to now when the client omits it", async () => {
    const t = convexTest(schema, modules);
    const before = Date.now();
    const response = await put(t, { lastReviewedAt: MORNING, device: "curl" });
    const { state } = await response.json();
    expect(state.updatedAt).toBeGreaterThanOrEqual(before);
  });

  test("an unnamed device is recorded as unknown rather than refused", async () => {
    const t = convexTest(schema, modules);
    const response = await put(t, { lastReviewedAt: MORNING, updatedAt: 1 });
    expect((await response.json()).state.device).toBe("unknown");
  });

  test.each([
    ["a missing lastReviewedAt", { updatedAt: 1 }, "lastReviewedAt"],
    ["a non-date lastReviewedAt", { lastReviewedAt: "soon", updatedAt: 1 }, "lastReviewedAt"],
    ["a non-numeric updatedAt", { lastReviewedAt: MORNING, updatedAt: "later" }, "updatedAt"],
    ["prefs that are not strings", { lastReviewedAt: MORNING, prefs: { n: 1 } }, "prefs"],
    ["prefs that are an array", { lastReviewedAt: MORNING, prefs: [1] }, "prefs"],
  ])("400s on %s", async (_label, body, field) => {
    const t = convexTest(schema, modules);
    const response = await put(t, body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(field);
  });

  test("400s on a body that is not a JSON object", async () => {
    const t = convexTest(schema, modules);
    expect((await put(t, "{nope")).status).toBe(400);
    expect((await put(t, [1, 2])).status).toBe(400);
  });

  test("a rejected write leaves the stored marker alone", async () => {
    const t = convexTest(schema, modules);
    await put(t, { lastReviewedAt: EVENING, updatedAt: 2000, device: "MacBook" });
    await put(t, { lastReviewedAt: "soon", updatedAt: 9999 });
    expect((await (await get(t)).json()).state).toMatchObject({ lastReviewedAt: EVENING });
  });
});
