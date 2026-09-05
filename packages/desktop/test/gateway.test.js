/**
 * What leaves the machine, and what must not.
 *
 * For a client that queues locally and sends later, "what left the machine" is
 * most of what there is to assert — so `fakeFetch` records every request and
 * these checks read it back.
 *
 * The two that carry weight: the credential appears in exactly one place, and a
 * captive portal's `200` is not counted as an acknowledgement. The second one
 * silently destroys content — the entry is deleted from the queue on `ok`, so a
 * portal that answers every request with a login page empties the queue into
 * nothing.
 *
 * ## Sabotage record
 *
 *   the token appended to the URL as well as the header                  1 failure
 *   the non-JSON check on a 2xx removed                                  1 failure
 *   the fetch error passed through as `String(error)`                    2 failures
 *   `null` token treated as a refusal rather than "not connected yet"    1 failure
 *   `drainOnce` ignoring `maxRequests`                                   1 failure
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, defaultCodeForStatus, defaultRetryable, defineOutbox, drainOnce, postEntry } from "../src/index.js";

const outbox = defineOutbox({ kinds: ["create", "finish"] });
const TOKEN = "test-token-not-a-real-credential";

function fakeFetch(responses) {
  const calls = [];
  let index = 0;
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const answer = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (typeof answer === "function") return answer(url, init);
    const { status = 200, body = {}, text, contentType = "application/json" } = answer ?? {};
    return new Response(text ?? JSON.stringify(body), { status, headers: { "content-type": contentType } });
  };
  impl.calls = calls;
  return impl;
}

const config = (fetchImpl, overrides = {}) => ({
  baseUrl: "https://api.example.test/v1",
  route: (entry) => `/subjects/${entry.subjectId}/${entry.kind}`,
  token: async () => TOKEN,
  fetch: fetchImpl,
  ...overrides,
});

const entry = { id: "s1:create", subjectId: "s1", kind: "create", body: { text: "hello" } };

test("THE CREDENTIAL IS IN A HEADER AND PROVABLY NOWHERE ELSE", () => {
  const impl = fakeFetch([{ status: 200 }]);
  return postEntry(config(impl), entry).then((result) => {
    assert.deepEqual(result, { ok: true });
    const [call] = impl.calls;
    assert.equal(call.url, "https://api.example.test/v1/subjects/s1/create");
    assert.equal(call.init.headers.authorization, `Bearer ${TOKEN}`);
    // Not in the path, not in a query string, not in the body.
    assert.equal(call.url.includes(TOKEN), false, "no token in the URL");
    assert.equal(String(call.init.body).includes(TOKEN), false, "no token in the body");
  });
});

test("A CAPTIVE PORTAL'S 200 IS NOT AN ACKNOWLEDGEMENT", async () => {
  // The failure this prevents: the entry is deleted from the queue on `ok`, so
  // counting a login page as a successful write drops the content for good.
  const impl = fakeFetch([{ status: 200, text: "<html>Sign in to Airport WiFi</html>", contentType: "text/html" }]);
  const result = await postEntry(config(impl), entry);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.unavailable);
  assert.equal(result.retryable, true);
});

test("a server error names a code from its own body when it sends one", async () => {
  const impl = fakeFetch([{ status: 403, body: { error: "grant_revoked", message: "reconnect this machine" } }]);
  const result = await postEntry(config(impl), entry);
  assert.equal(result.code, "grant_revoked");
  assert.equal(result.message, "reconnect this machine");
  assert.equal(result.retryable, true, "an unrecognised code backs off rather than parking somebody's work");
});

test("an error body that will not parse keeps the status-derived code", async () => {
  const impl = fakeFetch([{ status: 403, text: "no", contentType: "text/plain" }]);
  const result = await postEntry(config(impl), entry);
  assert.equal(result.code, ERROR_CODES.forbidden);
  assert.equal(result.retryable, false);
  assert.equal(result.message, "server answered 403");
});

test("statuses map to the four answers a queue can act on", () => {
  assert.equal(defaultCodeForStatus(401), ERROR_CODES.forbidden);
  assert.equal(defaultCodeForStatus(403), ERROR_CODES.forbidden);
  assert.equal(defaultCodeForStatus(409), ERROR_CODES.conflict);
  assert.equal(defaultCodeForStatus(412), ERROR_CODES.conflict);
  assert.equal(defaultCodeForStatus(400), ERROR_CODES.invalid);
  assert.equal(defaultCodeForStatus(422), ERROR_CODES.invalid);
  assert.equal(defaultCodeForStatus(500), ERROR_CODES.unavailable);
  assert.equal(defaultCodeForStatus(502), ERROR_CODES.unavailable);

  assert.equal(defaultRetryable(ERROR_CODES.invalid), false);
  assert.equal(defaultRetryable(ERROR_CODES.forbidden), false);
  assert.equal(defaultRetryable(ERROR_CODES.conflict), true);
  assert.equal(defaultRetryable("something-new"), true);
});

test("a network failure is described without repeating the request", async () => {
  const secretUrl = `https://api.example.test/v1?token=${TOKEN}`;
  const impl = async () => {
    throw new TypeError(`fetch failed for ${secretUrl}`);
  };
  const result = await postEntry(config(impl), entry);
  assert.equal(result.ok, false);
  assert.equal(result.message, "the network is unreachable");
  // A fetch failure's own message can carry the request URL, and this string is
  // written to a log file.
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test("a timeout is reported as itself and is retryable", async () => {
  const impl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  const result = await postEntry(config(impl, { timeoutMs: 5 }), entry);
  assert.equal(result.message, "the request timed out");
  assert.equal(result.retryable, true);
});

test("a machine that is not connected yet waits rather than failing", async () => {
  const impl = fakeFetch([{ status: 200 }]);
  const result = await postEntry(config(impl, { token: async () => null }), entry);
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true, "the queue holds until somebody connects it");
  assert.equal(impl.calls.length, 0, "and nothing is sent");
});

test("a drain empties a full queue on reconnect, in order, and bounded", async () => {
  let queue = outbox.empty();
  for (let subject = 0; subject < 40; subject += 1) {
    queue = outbox.queue(queue, { subjectId: `s${subject}`, kind: "create", body: {}, now: subject });
  }
  const impl = fakeFetch([{ status: 200 }]);
  const first = await drainOnce(queue, outbox, config(impl), () => 1_000, 25);
  assert.equal(first.sent, 25, "one pass does not fire forty requests in a burst");
  assert.equal(first.outbox.entries.length, 15);

  const second = await drainOnce(first.outbox, outbox, config(impl), () => 1_000, 25);
  assert.equal(second.sent, 15);
  assert.equal(second.outbox.entries.length, 0);
});

test("a drain reports what parked, and stops offering it", async () => {
  let queue = outbox.empty();
  queue = outbox.queue(queue, { subjectId: "s1", kind: "create", body: {}, now: 0 });
  queue = outbox.queue(queue, { subjectId: "s2", kind: "create", body: {}, now: 1 });
  const impl = fakeFetch([{ status: 400, body: { error: "invalid", message: "malformed" } }, { status: 200 }]);

  const report = await drainOnce(queue, outbox, config(impl), () => 10);
  assert.equal(report.sent, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.parked, 1);
  assert.equal(report.outbox.entries.length, 1);
  assert.equal(report.outbox.entries[0].subjectId, "s1");
});
