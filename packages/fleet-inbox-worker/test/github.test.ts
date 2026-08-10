import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  GitHubClient,
  GitHubError,
  githubTokens,
  ownerOf,
  parseInitiativesFile,
  tokenEnvKey,
} from "../src/github";
import type { Env } from "../src/env";

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

/** Every test repo below is owned by `o`, so one entry covers the fleet. */
function client(tokens: Record<string, string> = { o: "t" }): GitHubClient {
  return new GitHubClient(tokens);
}

const realLog = console.log;
afterEach(() => {
  console.log = realLog;
});

/** Collect the structured log lines a call emits, parsed back into objects. */
function captureLogs(): Array<Record<string, unknown>> {
  const lines: Array<Record<string, unknown>> = [];
  console.log = (line: unknown) => {
    lines.push(JSON.parse(String(line)) as Record<string, unknown>);
  };
  return lines;
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

  const initiatives = await client().listInitiatives("o/r");
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

  assert.deepEqual(await client().listInitiatives("o/r"), [
    { name: "wa-parity" },
  ]);
});

test("a repo the token cannot see contributes nothing rather than failing", async () => {
  // One unreachable repo must not cost the owner the whole voice note.
  mockFetch([
    { match: /contents\/\.fleet/, status: 403 },
    { match: /\/labels/, status: 403 },
  ]);
  assert.deepEqual(await client().listInitiatives("o/private"), []);
});

test("a malformed initiatives file degrades to labels, it does not throw (M6)", async () => {
  // JSON.parse raises a SyntaxError, which is not a GitHubError — an earlier
  // version rethrew it, and because the caller fans out across four repos, one
  // repo's bad file killed every voice note.
  mockFetch([
    { match: /contents\/\.fleet/, body: { content: base64("{ not json at all") } },
    { match: /\/labels/, body: [{ name: "init:fallback" }] },
  ]);

  assert.deepEqual(await client().listInitiatives("o/r"), [{ name: "fallback" }]);
});

test("a corrupt base64 payload also degrades to labels (M6)", async () => {
  // atob raises InvalidCharacterError — likewise not a GitHubError.
  mockFetch([
    { match: /contents\/\.fleet/, body: { content: "!!! not base64 !!!" } },
    { match: /\/labels/, body: [{ name: "init:fallback" }] },
  ]);

  assert.deepEqual(await client().listInitiatives("o/r"), [{ name: "fallback" }]);
});

test("a malformed file with unreachable labels yields an empty list, still no throw", async () => {
  mockFetch([
    { match: /contents\/\.fleet/, body: { content: base64("[[[") } },
    { match: /\/labels/, status: 500 },
  ]);
  assert.deepEqual(await client().listInitiatives("o/r"), []);
});

/* -------------------------------------------------------------------------- */
/* Degraded routing is silent no longer (N2)                                   */
/* -------------------------------------------------------------------------- */

test("a repo with no initiatives at all says so in the log (N2)", async () => {
  // Both catches swallow, so this log line is the only way anyone learns that
  // an app has been routing without its initiatives for a month.
  mockFetch([
    { match: /contents\/\.fleet/, status: 500 },
    { match: /\/labels/, status: 500 },
  ]);
  const logs = captureLogs();

  assert.deepEqual(await client().listInitiatives("o/r"), []);
  const unavailable = logs.find((line) => line["event"] === "initiatives.unavailable");
  assert.ok(unavailable !== undefined, "the degraded-routing signal is emitted");
  assert.equal(unavailable["repo"], "o/r");
  assert.equal(unavailable["error"], "GitHubError");
});

test("a malformed initiatives file is logged even though labels rescue it (N2)", async () => {
  mockFetch([
    { match: /contents\/\.fleet/, body: { content: base64("{ not json at all") } },
    { match: /\/labels/, body: [{ name: "init:fallback" }] },
  ]);
  const logs = captureLogs();

  await client().listInitiatives("o/r");
  const unreadable = logs.find((line) => line["event"] === "initiatives.file_unreadable");
  assert.ok(unreadable !== undefined, "a broken repo-authored file is not silent");
  assert.equal(unreadable["error"], "SyntaxError");
});

test("the ordinary 404 for a repo with no .fleet/ stays quiet (N2)", async () => {
  // Most repos have no `.fleet/` yet. Logging that on every extraction, for
  // every repo, would bury the signal the two tests above are about.
  mockFetch([
    { match: /contents\/\.fleet/, status: 404 },
    { match: /\/labels/, body: [{ name: "init:wa-parity" }] },
  ]);
  const logs = captureLogs();

  await client().listInitiatives("o/r");
  assert.deepEqual(logs, []);
});

test("getIssue normalizes labels so the keep path can check them (M4)", async () => {
  mockFetch([
    {
      match: /issues\/9$/,
      body: {
        number: 9,
        title: "T",
        html_url: "u",
        labels: [{ name: "inbox:proposed" }, "size:m", { name: "" }, {}],
      },
    },
  ]);

  const issue = await client().getIssue("o/r", 9);
  assert.deepEqual(issue.labels, ["inbox:proposed", "size:m"]);
});

test("getIssue on an issue with no labels yields an empty array, not undefined", async () => {
  mockFetch([{ match: /issues\/9$/, body: { number: 9, title: "T", html_url: "u" } }]);
  assert.deepEqual((await client().getIssue("o/r", 9)).labels, []);
});

test("creating an issue posts title, body, and labels", async () => {
  const calls = mockFetch([
    { match: /\/issues$/, status: 201, body: { number: 9, html_url: "https://x/9" } },
  ]);

  const issue = await client().createIssue("o/r", {
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

  const github = client();
  await github.removeLabel("o/r", 9, "inbox:proposed");
  await github.addLabels("o/r", 9, ["agent:ready"]);

  assert.equal(calls[0]?.method, "DELETE");
  assert.match(calls[0]?.url ?? "", /labels\/inbox%3Aproposed$/, "the colon is encoded");
  assert.equal(calls[1]?.method, "POST");
  assert.deepEqual(calls[1]?.body, { labels: ["agent:ready"] });
});

test("removing a label that is already gone is success, not an error", async () => {
  mockFetch([{ match: /labels\//, status: 404 }]);
  await client().removeLabel("o/r", 9, "inbox:proposed");
});

test("rejecting an issue comments then closes it as not planned", async () => {
  const calls = mockFetch([
    { match: /\/comments$/, status: 201, body: {} },
    { match: /\/issues\/9$/, status: 200, body: {} },
  ]);

  const github = client();
  await github.comment("o/r", 9, "rejected via Telegram");
  await github.closeIssue("o/r", 9);

  assert.deepEqual(calls[0]?.body, { body: "rejected via Telegram" });
  assert.equal(calls[1]?.method, "PATCH");
  assert.deepEqual(calls[1]?.body, { state: "closed", state_reason: "not_planned" });
});

test("a failed write surfaces the status and GitHub's message", async () => {
  mockFetch([{ match: /\/issues$/, status: 422, body: { message: "Validation Failed" } }]);

  await assert.rejects(
    () => client().createIssue("o/r", { title: "T", body: "B", labels: [] }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.status, 422);
      assert.match(error.message, /422.*Validation Failed/);
      return true;
    },
  );
});

/* -------------------------------------------------------------------------- */
/* One token per resource owner (N5)                                           */
/* -------------------------------------------------------------------------- */

test("the owner half of a slug is what the token is keyed on (N5)", () => {
  assert.equal(ownerOf("togathernyc/togather"), "togathernyc");
  // GitHub logins are case-insensitive; fleet.ts spells this one `Supa-Media`.
  assert.equal(ownerOf("Supa-Media/events-os"), "supa-media");
});

test("the secret name for an owner is derivable, not configured (N5)", () => {
  assert.equal(tokenEnvKey("togathernyc"), "GH_TOKEN_TOGATHERNYC");
  assert.equal(tokenEnvKey("supa-media"), "GH_TOKEN_SUPA_MEDIA");
  assert.equal(tokenEnvKey("shyoh"), "GH_TOKEN_SHYOH");
});

/** The non-GitHub half of `Env`, which token resolution never reads. */
const envBase = {
  AI: { run: async () => ({ text: "" }) },
  INBOX_KV: { get: async () => null, put: async () => {} },
  TELEGRAM_BOT_TOKEN: "b",
  TELEGRAM_WEBHOOK_SECRET: "w",
  TELEGRAM_CHAT_ID: "42",
  ANTHROPIC_API_KEY: "sk",
} satisfies Omit<Env, "GH_TOKEN">;

test("each fleet owner resolves to its own token (N5)", () => {
  // The point of the whole exercise: a fine-grained PAT covers exactly one
  // resource owner, and the fleet spans three.
  assert.deepEqual(
    githubTokens({
      ...envBase,
      GH_TOKEN_TOGATHERNYC: "tg",
      GH_TOKEN_SUPA_MEDIA: "sm",
      GH_TOKEN_SHYOH: "sh",
    }),
    { togathernyc: "tg", "supa-media": "sm", shyoh: "sh" },
  );
});

test("GH_TOKEN still covers every owner that has no token of its own (N5)", () => {
  assert.deepEqual(githubTokens({ ...envBase, GH_TOKEN: "classic" }), {
    togathernyc: "classic",
    "supa-media": "classic",
    shyoh: "classic",
  });

  // Mixed: the per-owner secret wins where it exists.
  assert.deepEqual(
    githubTokens({ ...envBase, GH_TOKEN: "classic", GH_TOKEN_SHYOH: "sh" }),
    { togathernyc: "classic", "supa-media": "classic", shyoh: "sh" },
  );
});

test("an owner with no token at all is absent rather than empty (N5)", () => {
  assert.deepEqual(githubTokens({ ...envBase, GH_TOKEN_SHYOH: "sh" }), { shyoh: "sh" });
});

test("each repo is called with its own owner's token (N5)", async () => {
  const calls = mockFetch([{ match: /\/issues$/, status: 201, body: { number: 1 } }]);
  const github = client({ togathernyc: "tg", shyoh: "sh" });

  await github.createIssue("togathernyc/togather", { title: "T", body: "B", labels: [] });
  await github.createIssue("shyoh/fount-studios", { title: "T", body: "B", labels: [] });

  assert.equal(calls[0]?.headers["Authorization"], "Bearer tg");
  assert.equal(calls[1]?.headers["Authorization"], "Bearer sh");
});

test("a repo whose owner has no token fails by naming the secret to set (N5)", async () => {
  // This message reaches the owner as a Telegram DM. A 404 from GitHub — which
  // is what an unscoped token gets — would have him hunting the wrong problem.
  const calls = mockFetch([{ match: /./, status: 201, body: {} }]);

  await assert.rejects(
    () => client({ togathernyc: "tg" }).createIssue("shyoh/fount-studios", {
      title: "T",
      body: "B",
      labels: [],
    }),
    /No GitHub token for shyoh — set GH_TOKEN_SHYOH \(or GH_TOKEN\)/,
  );
  assert.equal(calls.length, 0, "nothing is sent unsigned");
});
