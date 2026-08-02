import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyReadToken, verifySignedRequest } from "./lib/auth";
import { MAX_BODY_BYTES, parseEventsBody } from "./lib/parseEvents";
import { RUN_EVENT_SOURCES, type RunEventSource } from "./schema";

/**
 * Every door into this backend.
 *
 * The Convex functions themselves are all `internal`, so this file is the only
 * place a credential is checked and the only place one *can* be checked. That
 * is deliberate: v1 has no Convex auth provider, so a function exported as
 * `query` would be reachable by anyone with the deployment URL — and deployment
 * URLs are not secrets, they ship in the dashboard's bundle.
 *
 * Two credentials, two capabilities — see `lib/auth.ts`:
 *   POST /fleet/events   HMAC over `<timestamp>.<body>`  (CI writes telemetry)
 *   GET  /fleet/events   Bearer FLEET_READ_TOKEN         (the dashboard reads)
 *   GET  /fleet/review   Bearer FLEET_READ_TOKEN
 *   POST /fleet/review   Bearer FLEET_READ_TOKEN         (your own marker)
 *   GET  /fleet/health   none                            (says nothing secret)
 *
 * **CORS is wide open, on purpose.** The dashboard is a static page on some
 * other origin and there is no session cookie anywhere in this design — every
 * request carries its credential in an `Authorization` header the browser will
 * not attach on its own. With no ambient authority to steal, `Access-Control-
 * Allow-Origin: *` grants a hostile page exactly what it already had: the
 * ability to make a request it cannot authenticate. Pinning an origin here
 * would look like a control and enforce nothing (curl ignores it), while
 * breaking every localhost preview.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, x-fleet-signature, x-fleet-timestamp",
  "Access-Control-Max-Age": "86400",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/**
 * Errors are `{ error }` and nothing else — never the value we compared
 * against, never how far the comparison got.
 */
function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

const http = httpRouter();

http.route({
  pathPrefix: "/fleet/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })),
});

/**
 * Telemetry ingest. HMAC-signed; the read token cannot reach it.
 *
 * The body is read as text *before* it is parsed, because the signature is over
 * those exact bytes — re-serializing the parsed object would produce a different
 * string for any writer whose JSON key order or spacing differs from ours,
 * which is all of them.
 */
http.route({
  path: "/fleet/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return fail(413, `Body must be at most ${MAX_BODY_BYTES} bytes`);
    }

    const now = Date.now();
    const auth = await verifySignedRequest(
      body,
      request.headers,
      process.env.FLEET_BACKEND_SECRET,
      now,
    );
    if (!auth.ok) return fail(auth.status, auth.message);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return fail(400, "Body is not valid JSON");
    }

    const parsed = parseEventsBody(parsedJson, now);
    if (!parsed.ok) return fail(400, parsed.message);

    const result = await ctx.runMutation(internal.runEvents.ingest, {
      events: parsed.events,
      receivedAt: now,
    });
    return json(result, 202);
  }),
});

http.route({
  path: "/fleet/events",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = verifyReadToken(request.headers, process.env.FLEET_READ_TOKEN);
    if (!auth.ok) return fail(auth.status, auth.message);

    const url = new URL(request.url);
    const now = Date.now();
    const since = parseSince(url.searchParams.get("since"), now);
    if (since === null) {
      return fail(400, "since must be unix milliseconds or an ISO-8601 string");
    }

    const source = url.searchParams.get("source");
    if (source !== null && !isKnownSource(source)) {
      return fail(400, `Unknown source: ${source}`);
    }

    const limitParam = url.searchParams.get("limit");
    if (limitParam !== null && !Number.isFinite(Number(limitParam))) {
      return fail(400, "limit must be a number");
    }

    const repo = url.searchParams.get("repo");
    const result = await ctx.runQuery(internal.runEvents.list, {
      since,
      now,
      ...(repo === null ? {} : { repo }),
      ...(source === null ? {} : { source }),
      ...(limitParam === null ? {} : { limit: Number(limitParam) }),
    });
    return json({ ...result, since: new Date(result.since).toISOString() });
  }),
});

http.route({
  path: "/fleet/review",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = verifyReadToken(request.headers, process.env.FLEET_READ_TOKEN);
    if (!auth.ok) return fail(auth.status, auth.message);
    const state = await ctx.runQuery(internal.reviewState.get, {});
    return json({ state });
  }),
});

http.route({
  path: "/fleet/review",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = verifyReadToken(request.headers, process.env.FLEET_READ_TOKEN);
    if (!auth.ok) return fail(auth.status, auth.message);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, "Body is not valid JSON");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return fail(400, "Body must be a JSON object");
    }

    const record = body as Record<string, unknown>;
    const lastReviewedAt = record.lastReviewedAt;
    if (typeof lastReviewedAt !== "string" || Number.isNaN(new Date(lastReviewedAt).getTime())) {
      return fail(400, "lastReviewedAt must be an ISO-8601 string");
    }
    // Defaulted rather than required: a client that knows when it marked but not
    // what clock we wanted is still telling the truth, and `now` is the honest
    // reading of "as far as this request knows, just now".
    const updatedAt = record.updatedAt === undefined ? Date.now() : Number(record.updatedAt);
    if (!Number.isFinite(updatedAt)) return fail(400, "updatedAt must be unix milliseconds");
    const device = typeof record.device === "string" ? record.device.slice(0, 64) : "unknown";

    let prefs: Record<string, string> | undefined;
    if (record.prefs !== undefined && record.prefs !== null) {
      if (typeof record.prefs !== "object" || Array.isArray(record.prefs)) {
        return fail(400, "prefs must be an object of strings");
      }
      const entries = Object.entries(record.prefs as Record<string, unknown>);
      if (entries.some(([, value]) => typeof value !== "string")) {
        return fail(400, "prefs must be an object of strings");
      }
      prefs = Object.fromEntries(entries) as Record<string, string>;
    }

    const result = await ctx.runMutation(internal.reviewState.set, {
      lastReviewedAt,
      updatedAt,
      device,
      ...(prefs === undefined ? {} : { prefs }),
    });
    return json(result);
  }),
});

/**
 * Liveness only. No auth, because it answers nothing an unauthenticated caller
 * could not learn by watching a 401 come back from anywhere else — and a health
 * check you need a credential for is one the uptime monitor will not run.
 */
http.route({
  path: "/fleet/health",
  method: "GET",
  handler: httpAction(async () => json({ ok: true })),
});

function parseSince(raw: string | null, now: number): number | null {
  if (raw === null) return now - 24 * 60 * 60 * 1000;
  const asNumber = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(asNumber)) return asNumber;
  const asDate = new Date(raw).getTime();
  return Number.isNaN(asDate) ? null : asDate;
}

function isKnownSource(value: string): value is RunEventSource {
  return (RUN_EVENT_SOURCES as readonly string[]).includes(value);
}

export default http;
