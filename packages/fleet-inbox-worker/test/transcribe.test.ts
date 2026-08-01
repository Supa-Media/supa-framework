import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { toAudioArray, transcribe, MAX_TRANSCRIBE_BYTES } from "../src/transcribe";
import { TelegramClient } from "../src/telegram";
import type { Env } from "../src/env";

test("the cap is the isolate's memory budget, not Telegram's 20MB (M2)", () => {
  // A 20MB buffer becomes a 20-million-element number[]; at ~4 bytes each
  // that's ~80MB against a 128MB isolate, and the OOM happens inside
  // ctx.waitUntil where nothing survives to tell the owner.
  assert.ok(
    MAX_TRANSCRIBE_BYTES <= 8 * 1024 * 1024,
    `cap is ${MAX_TRANSCRIBE_BYTES} — too large to hold as a number[]`,
  );
  assert.ok(MAX_TRANSCRIBE_BYTES >= 2 * 1024 * 1024, "still a few minutes of opus");
});

test("toAudioArray copies bytes without spreading them through argument lists", () => {
  const buffer = new Uint8Array([0, 1, 127, 128, 255]).buffer;
  assert.deepEqual(toAudioArray(buffer), [0, 1, 127, 128, 255]);
  assert.deepEqual(toAudioArray(new ArrayBuffer(0)), []);
});

test("toAudioArray survives a size that would blow the spread-argument limit", () => {
  // `[...new Uint8Array(buf)]` is fine here but the equivalent
  // `Array.prototype.push.apply` / Math.max-style spread patterns are not; this
  // pins the preallocated-loop behaviour at a size well past any arg limit.
  const size = 200_000;
  const audio = toAudioArray(new Uint8Array(size).fill(7).buffer);
  assert.equal(audio.length, size);
  assert.equal(audio[size - 1], 7);
});

/* -------------------------------------------------------------------------- */
/* transcribe()                                                                */
/* -------------------------------------------------------------------------- */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function envWith(run: Env["AI"]["run"]): Env {
  return {
    AI: { run },
    INBOX_KV: { async get() { return null; }, async put() {} },
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_WEBHOOK_SECRET: "s",
    TELEGRAM_CHAT_ID: "42",
    ANTHROPIC_API_KEY: "k",
    GH_TOKEN: "g",
  };
}

/** getFile then the file download, both succeeding with `bytes`. */
function mockDownload(bytes: number): void {
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).includes("/getFile")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: "a.ogg" } }) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(bytes) };
  }) as unknown as typeof fetch;
}

test("an oversized declared file is refused before anything is downloaded", async () => {
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error("should not be reached");
  }) as typeof fetch;

  const result = await transcribe(
    envWith(async () => ({ text: "" })),
    new TelegramClient("t"),
    { ref: { file_id: "v", file_size: MAX_TRANSCRIBE_BYTES + 1 }, kind: "video" },
  );

  assert.equal(result.ok, false);
  assert.equal(fetched, false, "no download attempted");
  assert.match(result.ok === false ? result.reason : "", /hold in memory/);
});

test("the real byte length is re-checked, because file_size can be absent", async () => {
  mockDownload(MAX_TRANSCRIBE_BYTES + 1);

  const result = await transcribe(
    envWith(async () => {
      throw new Error("AI must not be reached");
    }),
    new TelegramClient("t"),
    { ref: { file_id: "v" }, kind: "video" },
  );

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /hold in memory/);
});

test("a successful transcription returns the text", async () => {
  mockDownload(1024);
  const result = await transcribe(
    envWith(async () => ({ text: "  pin the thread  " })),
    new TelegramClient("t"),
    { ref: { file_id: "v" }, kind: "voice" },
  );
  assert.deepEqual(result, { ok: true, text: "pin the thread" });
});

test("an undecodable video says so instead of returning an empty transcript", async () => {
  mockDownload(1024);
  const result = await transcribe(
    envWith(async () => ({ text: "" })),
    new TelegramClient("t"),
    { ref: { file_id: "v" }, kind: "video" },
  );
  assert.equal(result.ok, false);
  // The honesty requirement: an empty result must not be indistinguishable
  // from a voice note that recorded silence.
  assert.match(result.ok === false ? result.reason : "", /couldn't get audio out of that video/);
});

test("an empty voice note is reported as empty, not as a decode failure", async () => {
  mockDownload(1024);
  const result = await transcribe(
    envWith(async () => ({ text: "   " })),
    new TelegramClient("t"),
    { ref: { file_id: "v" }, kind: "voice" },
  );
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /came back empty/);
});

test("a download failure never leaks the token-bearing URL (L6)", async () => {
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).includes("/getFile")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { file_path: "a.ogg" } }) };
    }
    throw new Error("connect ECONNREFUSED https://api.telegram.org/file/botSECRET/a.ogg");
  }) as typeof fetch;

  const result = await transcribe(
    envWith(async () => ({ text: "" })),
    new TelegramClient("SECRET"),
    { ref: { file_id: "v" }, kind: "voice" },
  );

  assert.equal(result.ok, false);
  const reason = result.ok === false ? result.reason : "";
  assert.doesNotMatch(reason, /SECRET/, "the bot token never reaches the reply");
  assert.match(reason, /network request failed/);
});
