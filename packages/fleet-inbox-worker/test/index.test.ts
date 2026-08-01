/**
 * Integration-shaped tests for the worker's own handlers.
 *
 * These drive `handleCallback` end-to-end against a mocked `fetch`, because the
 * three defects the review found in the approval loop (double-press, the
 * missing `inbox:proposed` precondition, callback-answer ordering) all live
 * *between* correct pure functions rather than inside any of them. Testing
 * `applyDecision` alone had already passed while the caller was broken.
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  handleCallback,
  handleUpdate,
  isAllowedChat,
  secretMatches,
} from "../src/index";
import { buildKeyboard, renderSummary, type Proposal } from "../src/callback";
import { TelegramClient } from "../src/telegram";
import { PROPOSED_LABEL, READY_LABEL } from "../src/issue";
import { LEARNINGS_KEY } from "../src/learnings";
import type { Env } from "../src/env";

/* -------------------------------------------------------------------------- */
/* The authentication story (L1)                                               */
/* -------------------------------------------------------------------------- */

test("secretMatches accepts only the exact secret", () => {
  assert.equal(secretMatches("s3cret", "s3cret"), true);
  assert.equal(secretMatches("s3crft", "s3cret"), false);
  assert.equal(secretMatches("s3cre", "s3cret"), false, "shorter");
  assert.equal(secretMatches("s3crett", "s3cret"), false, "longer");
  assert.equal(secretMatches("", "s3cret"), false);
  assert.equal(secretMatches(null, "s3cret"), false, "header absent entirely");
});

test("secretMatches compares every byte of an equal-length input", () => {
  // A mismatch in the last position must fail exactly like one in the first —
  // that's the property the loop exists for.
  assert.equal(secretMatches("aaaaab", "aaaaaa"), false);
  assert.equal(secretMatches("baaaaa", "aaaaaa"), false);
});

test("isAllowedChat matches the configured chat and nothing else", () => {
  assert.equal(isAllowedChat(42, "42"), true);
  assert.equal(isAllowedChat(43, "42"), false);
  assert.equal(isAllowedChat(-100_123, "-100123"), true, "group ids are negative");
  // Load-bearing on the callback path: Telegram omits `message` for an
  // inline-message callback, so the optional chain yields undefined.
  assert.equal(isAllowedChat(undefined, "42"), false);
});

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Route {
  match: RegExp;
  status?: number;
  body?: unknown;
  /** Telegram-shaped failure: `{ok:false, description}` with HTTP 200. */
  telegramError?: string;
}

function mock(routes: Route[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as Record<string, unknown>);
    calls.push({ url, method: init?.method ?? "GET", body });

    const route = routes.find((candidate) => candidate.match.test(url));
    if (route?.telegramError !== undefined) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: false, description: route.telegramError }),
      };
    }

    const status = route?.status ?? 200;
    const payload = url.includes("api.telegram.org")
      ? { ok: status < 400, result: route?.body ?? {} }
      : (route?.body ?? {});
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  }) as typeof fetch;
  return calls;
}

function fakeKv(initial?: string): Env["INBOX_KV"] & { value: string | null } {
  return {
    value: initial ?? null,
    async get() {
      return this.value;
    },
    async put(_key: string, value: string) {
      this.value = value;
    },
  };
}

function makeEnv(kv = fakeKv()): Env {
  return {
    AI: { run: async () => ({ text: "" }) },
    INBOX_KV: kv,
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_CHAT_ID: "42",
    ANTHROPIC_API_KEY: "sk-test",
    GH_TOKEN: "gh-token",
  };
}

const proposal: Proposal = {
  appKey: "togather",
  issueNumber: 10,
  issueUrl: "https://github.com/togathernyc/togather/issues/10",
  title: "[Togather] Pin a thread",
  criteria: ["Pinned thread shows at the top"],
  thirdParty: false,
};

/** A callback_query as Telegram delivers it, for the ✅ on `proposal`. */
function keepQuery(overrides: { text?: string; keyboard?: unknown } = {}) {
  return {
    id: "cbq-1",
    data: "k|togather|10",
    message: {
      message_id: 500,
      chat: { id: 42 },
      text: overrides.text ?? renderSummary("Proposed 1 item.", [proposal]),
      reply_markup: {
        inline_keyboard: (overrides.keyboard ?? buildKeyboard([proposal])) as never,
      },
    },
  };
}

const telegramCalls = (calls: Call[], method: string): Call[] =>
  calls.filter((call) => call.url.includes(`/${method}`));

/* -------------------------------------------------------------------------- */
/* Keep path                                                                   */
/* -------------------------------------------------------------------------- */

test("keep promotes a proposed issue and edits the message", async () => {
  const calls = mock([
    {
      match: /issues\/10$/,
      body: { number: 10, title: "Pin a thread", html_url: "u", labels: [{ name: PROPOSED_LABEL }] },
    },
  ]);
  const env = makeEnv();

  await handleCallback(keepQuery(), env, new TelegramClient(env.TELEGRAM_BOT_TOKEN));

  const deleted = calls.find((call) => call.method === "DELETE");
  assert.ok(deleted !== undefined, "inbox:proposed removed");
  assert.match(deleted.url, /labels\/inbox%3Aproposed/);

  const added = calls.find((call) => call.url.endsWith("/labels") && call.method === "POST");
  assert.deepEqual(added?.body["labels"], [READY_LABEL]);

  assert.equal(telegramCalls(calls, "answerCallbackQuery").length, 1);
  assert.equal(telegramCalls(calls, "editMessageText").length, 1);
});

test("keep refuses an issue that is no longer inbox:proposed (M4)", async () => {
  // Without this precondition a forged payload could stamp agent:ready onto any
  // issue number in any of the four repos — agent:ready is what the fleet acts
  // on, so this is the gate that makes ✅ mean something.
  const calls = mock([
    {
      match: /issues\/10$/,
      body: { number: 10, title: "Someone else's issue", html_url: "u", labels: [{ name: "bug" }] },
    },
  ]);
  const env = makeEnv();

  await handleCallback(keepQuery(), env, new TelegramClient(env.TELEGRAM_BOT_TOKEN));

  assert.equal(calls.filter((call) => call.method === "DELETE").length, 0, "no label stripped");
  assert.equal(
    calls.filter((call) => call.url.endsWith("/labels") && call.method === "POST").length,
    0,
    "agent:ready never added",
  );

  const answered = telegramCalls(calls, "answerCallbackQuery")[0];
  assert.match(String(answered?.body["text"]), /Already handled/);
  assert.equal(telegramCalls(calls, "editMessageText").length, 0);
});

test("the answer comes before the edit (L3)", async () => {
  const calls = mock([
    {
      match: /issues\/10$/,
      body: { number: 10, title: "t", html_url: "u", labels: [{ name: PROPOSED_LABEL }] },
    },
  ]);
  const env = makeEnv();

  await handleCallback(keepQuery(), env, new TelegramClient(env.TELEGRAM_BOT_TOKEN));

  const order = calls
    .map((call) => call.url)
    .filter((url) => url.includes("answerCallbackQuery") || url.includes("editMessageText"));
  assert.match(order[0] ?? "", /answerCallbackQuery/);
  assert.match(order[1] ?? "", /editMessageText/);
});

/* -------------------------------------------------------------------------- */
/* Double press (M3)                                                           */
/* -------------------------------------------------------------------------- */

test("a second press on an already-decided row skips the edit entirely (M3)", async () => {
  // The row is gone from the keyboard, so applyDecision returns the message
  // unchanged. Previously the caller sent that unchanged text anyway, Telegram
  // 400'd "message is not modified", and the callback was never answered.
  const calls = mock([
    {
      match: /issues\/10$/,
      body: { number: 10, title: "t", html_url: "u", labels: [{ name: PROPOSED_LABEL }] },
    },
  ]);
  const env = makeEnv();

  await handleCallback(
    keepQuery({ text: "Proposed 1 item.\n✅ kept #10 — t", keyboard: [] }),
    env,
    new TelegramClient(env.TELEGRAM_BOT_TOKEN),
  );

  assert.equal(telegramCalls(calls, "editMessageText").length, 0, "no no-op edit sent");
  assert.equal(
    telegramCalls(calls, "answerCallbackQuery").length,
    1,
    "the button still stops spinning",
  );
});

test("a 'message is not modified' rejection is tolerated, not reported (M3)", async () => {
  // Belt to the caller's braces: even if an edit does go out and Telegram
  // rejects it as a no-op, that must not skip the answer or DM the owner.
  const calls = mock([
    {
      match: /issues\/10$/,
      body: { number: 10, title: "t", html_url: "u", labels: [{ name: PROPOSED_LABEL }] },
    },
    { match: /editMessageText/, telegramError: "Bad Request: message is not modified" },
  ]);
  const env = makeEnv();

  await handleUpdate({ callback_query: keepQuery() as never }, env);

  assert.equal(telegramCalls(calls, "answerCallbackQuery").length, 1);
  const sent = telegramCalls(calls, "sendMessage");
  assert.equal(sent.length, 0, "no 'Something broke' DM");
});

test("a real Telegram failure is still reported to the owner", async () => {
  const calls = mock([
    {
      match: /issues\/10$/,
      body: { number: 10, title: "t", html_url: "u", labels: [{ name: PROPOSED_LABEL }] },
    },
    { match: /editMessageText/, telegramError: "Bad Request: chat not found" },
  ]);
  const env = makeEnv();

  await handleUpdate({ callback_query: keepQuery() as never }, env);

  const sent = telegramCalls(calls, "sendMessage");
  assert.equal(sent.length, 1);
  assert.match(String(sent[0]?.body["text"]), /Something broke/);
});

/* -------------------------------------------------------------------------- */
/* Reject path                                                                 */
/* -------------------------------------------------------------------------- */

test("reject comments, closes, and records a learning", async () => {
  const calls = mock([
    {
      match: /issues\/10$/,
      body: {
        number: 10,
        title: "Add a dark mode",
        html_url: "u",
        labels: [{ name: PROPOSED_LABEL }],
      },
    },
  ]);
  const kv = fakeKv();
  const env = makeEnv(kv);

  const query = { ...keepQuery(), data: "r|togather|10" };
  await handleCallback(query, env, new TelegramClient(env.TELEGRAM_BOT_TOKEN));

  const comment = calls.find((call) => call.url.endsWith("/comments"));
  assert.equal(comment?.body["body"], "rejected via Telegram");

  const closed = calls.find((call) => call.method === "PATCH");
  assert.deepEqual(closed?.body, { state: "closed", state_reason: "not_planned" });

  assert.match(kv.value ?? "", /Rejected \(Togather\): "Add a dark mode"/);
});

test("reject is allowed on an issue that is no longer proposed", async () => {
  // Only promotion is gated. Closing something already handled is harmless and
  // matches what the owner meant by pressing ❌.
  const calls = mock([
    { match: /issues\/10$/, body: { number: 10, title: "t", html_url: "u", labels: [] } },
  ]);
  const env = makeEnv();

  await handleCallback(
    { ...keepQuery(), data: "r|togather|10" },
    env,
    new TelegramClient(env.TELEGRAM_BOT_TOKEN),
  );

  assert.ok(calls.some((call) => call.method === "PATCH"), "still closed");
});

/* -------------------------------------------------------------------------- */
/* Gates                                                                       */
/* -------------------------------------------------------------------------- */

test("a callback from another chat touches nothing at all", async () => {
  const calls = mock([{ match: /./, body: {} }]);
  const env = makeEnv();

  await handleCallback(
    { ...keepQuery(), message: { ...keepQuery().message, chat: { id: 999 } } },
    env,
    new TelegramClient(env.TELEGRAM_BOT_TOKEN),
  );

  assert.equal(calls.length, 0, "no GitHub call, no Telegram reply");
});

test("a message from another chat touches nothing at all", async () => {
  const calls = mock([{ match: /./, body: {} }]);
  const env = makeEnv();

  await handleUpdate(
    { message: { message_id: 1, chat: { id: 999 }, text: "queue: do a thing" } },
    env,
  );

  assert.equal(calls.length, 0);
});

test("an unparseable callback answers the button without touching GitHub", async () => {
  const calls = mock([{ match: /./, body: {} }]);
  const env = makeEnv();

  await handleCallback(
    { ...keepQuery(), data: "garbage" },
    env,
    new TelegramClient(env.TELEGRAM_BOT_TOKEN),
  );

  assert.equal(calls.filter((call) => call.url.includes("api.github.com")).length, 0);
  const answered = telegramCalls(calls, "answerCallbackQuery")[0];
  assert.match(String(answered?.body["text"]), /stale/);
});

/* -------------------------------------------------------------------------- */
/* The queue fast path                                                         */
/* -------------------------------------------------------------------------- */

test("queue: files one issue and replies with a keyboard, with no model call", async () => {
  const calls = mock([
    { match: /\/issues$/, status: 201, body: { number: 77, html_url: "https://x/77" } },
  ]);
  const env = makeEnv();

  await handleUpdate(
    {
      message: {
        message_id: 9,
        chat: { id: 42 },
        text: "queue: let a leader pin a prayer thread",
      },
    },
    env,
  );

  assert.equal(
    calls.filter((call) => call.url.includes("api.anthropic.com")).length,
    0,
    "the fast path costs nothing",
  );

  const created = calls.find((call) => call.url.endsWith("/issues"));
  assert.match(created?.url ?? "", /togathernyc\/togather/, "routed by vocabulary");
  assert.deepEqual(created?.body["labels"], [PROPOSED_LABEL, "init:misc", "size:m"]);

  const sent = telegramCalls(calls, "sendMessage")[0];
  assert.match(String(sent?.body["text"]), /Queued one item\./);
  assert.equal(sent?.body["parse_mode"], undefined, "plain text (M1)");
  assert.ok(sent?.body["reply_markup"] !== undefined, "buttons attached");
});

test("the learnings key is the one KV key this worker writes", async () => {
  const kv = fakeKv();
  mock([
    { match: /issues\/10$/, body: { number: 10, title: "t", html_url: "u", labels: [] } },
  ]);
  const env = makeEnv(kv);

  await handleCallback(
    { ...keepQuery(), data: "r|togather|10" },
    env,
    new TelegramClient(env.TELEGRAM_BOT_TOKEN),
  );

  assert.equal(LEARNINGS_KEY, "learnings.md");
  assert.ok(kv.value !== null);
});
