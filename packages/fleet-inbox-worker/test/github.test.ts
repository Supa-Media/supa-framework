import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GitHubClient, GitHubError, parseInitiativesFile } from "../src/github";

/* -------------------------------------------------------------------------- */
/* fetch mock                                                                  */
/* -------------------------------------------------------------------------- */

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(
  routes: Array<{ match: RegExp; status?: number; body?: unknown }>,
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const route = routes.find((candidate) => candidate.match.test(url));
    const status = route?.status ?? (route === undefined ? 404 : 200);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route?.body ?? { message: "Not Found" },
    };
  }) as typeof fetch;
  return calls;
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/* -------------------------------------------------------------------------- */
/* .fleet/initiatives.json parsing                                             */
/* -------------------------------------------------------------------------- */

test("initiatives file accepts the three shapes a human would write", () => {
  assert.deepEqual(parseInitiativesFile(["wa-parity", "inbox"]), [
    { name: "wa-parity" },
    { name: "inbox" },
  ]);
  assert.deepEqual(parseInitiativesFile([{ name: "inbox", description: "the fleet inbox" }]), [
    { name: "inbox", description: "the fleet inbox" },
  ]);
  assert.deepEqual(parseInitiativesFile({ initiatives: ["a", { name: "b" }] }), [
    { name: "a" },
    { name: "b" },
  ]);
});

test("initiatives file drops unusable entries instead of failing", () => {
  assert.deepEqual(
    parseInitiativesFile(["  ", "", { description: "no name" }, 42, null, "kept"]),
    [{ name: "kept" }],
  );
  assert.deepEqual(parseInitiativesFile("nonsense"), []);
  assert.deepEqual(parseInitiativesFile(null), []);
});

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

test("initiatives come from .fleet/initiatives.json when it exists", async () => {
  const calls = mockFetch([
    {
      match: /contents\/\.fleet\/initiatives\.json/,
      body: { content: base64(JSON.stringify({ initiatives: [{ name: "inbox" }] })) },
    },
  ]);

  const initiatives = await new GitHubClient("t").listInitiatives("o/r");
  assert.deepEqual(initiatives, [{ name: "inbox" }]);
  assert.equal(calls.length, 1, "labels are not fetched when the file exists");
  assert.equal(calls[0]?.headers["Authorization"], "Bearer t");
});

test("initiatives fall back to init:* labels when the file is absent", async () => {
  mockFetch([
    { match: /contents\/\.fleet/, status: 404 },
    {
      match: /\/labels/,
      body: [{ name: "init:wa-parity" }, { name: "bug" }, { name: "init:" }],
    },
  ]);

  assert.deepEqual(await new GitHubClient("t").listInitiatives("o/r"), [
    { name: "wa-parity" },
  ]);
});

test("a repo the token cannot see contributes nothing rather than failing", async () => {
  // One unreachable repo must not cost the owner the whole voice note.
  mockFetch([
    { match: /contents\/\.fleet/, status: 403 },
    { match: /\/labels/, status: 403 },
  ]);
  assert.deepEqual(await new GitHubClient("t").listInitiatives("o/private"), []);
});

test("creating an issue posts title, body, and labels", async () => {
  const calls = mockFetch([
    { match: /\/issues$/, status: 201, body: { number: 9, html_url: "https://x/9" } },
  ]);

  const issue = await new GitHubClient("t").createIssue("o/r", {
    title: "T",
    body: "B",
    labels: ["inbox:proposed"],
  });

  assert.deepEqual(issue, { number: 9, html_url: "https://x/9" });
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(calls[0]?.body, { title: "T", body: "B", labels: ["inbox:proposed"] });
});

test("keeping an issue removes the proposed label and adds the ready one", async () => {
  const calls = mockFetch([
    { match: /labels\/inbox%3Aproposed/, status: 204 },
    { match: /\/labels$/, status: 200, body: [] },
  ]);

  const github = new GitHubClient("t");
  await github.removeLabel("o/r", 9, "inbox:proposed");
  await github.addLabels("o/r", 9, ["agent:ready"]);

  assert.equal(calls[0]?.method, "DELETE");
  assert.match(calls[0]?.url ?? "", /labels\/inbox%3Aproposed$/, "the colon is encoded");
  assert.equal(calls[1]?.method, "POST");
  assert.deepEqual(calls[1]?.body, { labels: ["agent:ready"] });
});

test("removing a label that is already gone is success, not an error", async () => {
  mockFetch([{ match: /labels\//, status: 404 }]);
  await new GitHubClient("t").removeLabel("o/r", 9, "inbox:proposed");
});

test("rejecting an issue comments then closes it as not planned", async () => {
  const calls = mockFetch([
    { match: /\/comments$/, status: 201, body: {} },
    { match: /\/issues\/9$/, status: 200, body: {} },
  ]);

  const github = new GitHubClient("t");
  await github.comment("o/r", 9, "rejected via Telegram");
  await github.closeIssue("o/r", 9);

  assert.deepEqual(calls[0]?.body, { body: "rejected via Telegram" });
  assert.equal(calls[1]?.method, "PATCH");
  assert.deepEqual(calls[1]?.body, { state: "closed", state_reason: "not_planned" });
});

test("a failed write surfaces the status and GitHub's message", async () => {
  mockFetch([{ match: /\/issues$/, status: 422, body: { message: "Validation Failed" } }]);

  await assert.rejects(
    () => new GitHubClient("t").createIssue("o/r", { title: "T", body: "B", labels: [] }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.status, 422);
      assert.match(error.message, /422.*Validation Failed/);
      return true;
    },
  );
});
