import { describe, expect, test } from "vitest";

import { MAX_CLOCK_SKEW_MS } from "../convex/lib/auth";
import { MAX_BATCH, MAX_KIND_LENGTH, parseEventsBody } from "../convex/lib/parseEvents";

const NOW = 1_800_000_000_000;

function ok(body: unknown) {
  const result = parseEventsBody(body, NOW);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.message}`);
  return result.events;
}

function why(body: unknown): string {
  const result = parseEventsBody(body, NOW);
  if (result.ok) throw new Error("expected a rejection");
  return result.message;
}

const MINIMAL = { source: "watchdog", repo: "Supa-Media/events-os", kind: "wake" };

describe("parseEventsBody", () => {
  test("accepts a bare event, defaulting `at` to now", () => {
    expect(ok(MINIMAL)).toEqual([
      { source: "watchdog", repo: "supa-media/events-os", kind: "wake", at: NOW },
    ]);
  });

  test("accepts a batch under `events`", () => {
    const events = ok({ events: [MINIMAL, { ...MINIMAL, kind: "respawn" }] });
    expect(events.map((event) => event.kind)).toEqual(["wake", "respawn"]);
  });

  test("lowercases the repo so it merges against ProjectSnapshot.key", () => {
    expect(ok(MINIMAL)[0]?.repo).toBe("supa-media/events-os");
  });

  test("takes `at` as unix ms or ISO-8601", () => {
    expect(ok({ ...MINIMAL, at: 123 })[0]?.at).toBe(123);
    expect(ok({ ...MINIMAL, at: "2026-08-01T00:00:00.000Z" })[0]?.at).toBe(
      Date.parse("2026-08-01T00:00:00.000Z"),
    );
  });

  test("carries the optional fields through", () => {
    const [event] = ok({
      ...MINIMAL,
      issueNumber: 42,
      url: "https://github.com/a/b/actions/runs/1",
      dedupeKey: " run-1 ",
      payload: { respawns: 2, note: "stalled" },
    });
    expect(event).toMatchObject({
      issueNumber: 42,
      url: "https://github.com/a/b/actions/runs/1",
      dedupeKey: "run-1",
      payload: { respawns: 2, note: "stalled" },
    });
  });

  test("treats null optionals as absent — a shell writer emitting nulls is not an error", () => {
    const [event] = ok({ ...MINIMAL, issueNumber: null, url: null, dedupeKey: null, payload: null });
    expect(event).toEqual({ source: "watchdog", repo: "supa-media/events-os", kind: "wake", at: NOW });
  });

  test.each([
    ["a non-object body", "nope", "Body must be a JSON object"],
    ["an array body", [MINIMAL], "Body must be a JSON object"],
    ["an empty batch", { events: [] }, "events must not be empty"],
  ])("rejects %s", (_label, body, message) => {
    expect(why(body)).toBe(message);
  });

  test("rejects an oversized batch", () => {
    const events = Array.from({ length: MAX_BATCH + 1 }, () => MINIMAL);
    expect(why({ events })).toContain(`at most ${MAX_BATCH}`);
  });

  test("names the offending index rather than failing anonymously", () => {
    expect(why({ events: [MINIMAL, { ...MINIMAL, kind: "" }] })).toContain("events[1].kind");
  });

  test("rejects an unknown source", () => {
    expect(why({ ...MINIMAL, source: "cron" })).toContain("source must be one of");
    expect(why({ ...MINIMAL, source: 3 })).toContain("source must be one of");
  });

  test("rejects a repo that is not owner/name", () => {
    expect(why({ ...MINIMAL, repo: "events-os" })).toContain("owner/name");
    expect(why({ ...MINIMAL, repo: "" })).toContain("owner/name");
  });

  test("rejects a blank or overlong kind", () => {
    expect(why({ ...MINIMAL, kind: "   " })).toContain("kind must be");
    expect(why({ ...MINIMAL, kind: "k".repeat(MAX_KIND_LENGTH + 1) })).toContain("kind must be");
  });

  test("rejects an unparseable `at`", () => {
    expect(why({ ...MINIMAL, at: "when I woke up" })).toContain("at must be");
    expect(why({ ...MINIMAL, at: Number.POSITIVE_INFINITY })).toContain("at must be");
    expect(why({ ...MINIMAL, at: {} })).toContain("at must be");
  });

  test("rejects a future `at` — it would sort above everything in every window", () => {
    expect(why({ ...MINIMAL, at: 32_500_000_000_000 })).toContain("not in the future");
    expect(why({ ...MINIMAL, at: NOW + MAX_CLOCK_SKEW_MS + 1 })).toContain("not in the future");
    expect(why({ ...MINIMAL, at: "3000-01-01T00:00:00.000Z" })).toContain("not in the future");
  });

  test("accepts an `at` inside the skew the signature layer already allows", () => {
    expect(ok({ ...MINIMAL, at: NOW + MAX_CLOCK_SKEW_MS })[0]?.at).toBe(NOW + MAX_CLOCK_SKEW_MS);
  });

  test("the past has no ceiling — an old event simply ages out of the window", () => {
    expect(ok({ ...MINIMAL, at: 0 })[0]?.at).toBe(0);
  });

  test("rejects a non-positive or fractional issueNumber", () => {
    expect(why({ ...MINIMAL, issueNumber: 0 })).toContain("positive integer");
    expect(why({ ...MINIMAL, issueNumber: 1.5 })).toContain("positive integer");
    expect(why({ ...MINIMAL, issueNumber: "12" })).toContain("positive integer");
  });

  test("rejects a url that is not http(s) — a javascript: link would be rendered", () => {
    expect(why({ ...MINIMAL, url: "javascript:alert(1)" })).toContain("http(s) URL");
    expect(why({ ...MINIMAL, url: "github.com/a/b" })).toContain("http(s) URL");
  });

  test("rejects a payload that is not an object", () => {
    expect(why({ ...MINIMAL, payload: [1, 2] })).toContain("payload must be an object");
    expect(why({ ...MINIMAL, payload: "stalled" })).toContain("payload must be an object");
  });

  test("rejects an unusable dedupeKey", () => {
    expect(why({ ...MINIMAL, dedupeKey: "  " })).toContain("dedupeKey must be");
    expect(why({ ...MINIMAL, dedupeKey: "k".repeat(201) })).toContain("dedupeKey must be");
  });
});
