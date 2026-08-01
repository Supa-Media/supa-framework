import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMessage, type TelegramMessage } from "../src/telegram";

function message(fields: Partial<TelegramMessage>): TelegramMessage {
  return { message_id: 1, chat: { id: 42 }, ...fields };
}

test("plain text", () => {
  const described = describeMessage(message({ text: "  fix the badge  " }));
  assert.equal(described.kind, "text");
  assert.equal(described.text, "fix the badge");
  assert.equal(described.media, null);
});

test("a forwarded message is marked as a forward", () => {
  assert.equal(
    describeMessage(message({ text: "look at this", forward_origin: { type: "user" } })).kind,
    "forward",
  );
  // Some clients still send only the legacy marker.
  assert.equal(
    describeMessage(message({ text: "look at this", forward_date: 1_700_000_000 })).kind,
    "forward",
  );
});

test("a voice note carries its file and any caption", () => {
  const described = describeMessage(
    message({ voice: { file_id: "v1", file_size: 900 }, caption: "context" }),
  );
  assert.equal(described.kind, "voice");
  assert.equal(described.media?.ref.file_id, "v1");
  assert.equal(described.media?.kind, "voice");
  assert.equal(described.text, "context");
});

test("audio is treated the same as a voice note", () => {
  const described = describeMessage(message({ audio: { file_id: "a1" } }));
  assert.equal(described.kind, "voice");
  assert.equal(described.media?.kind, "voice");
});

test("video and video notes are video", () => {
  assert.equal(describeMessage(message({ video: { file_id: "vid" } })).media?.kind, "video");
  assert.equal(describeMessage(message({ video_note: { file_id: "vn" } })).media?.kind, "video");
});

test("media wins over text — a captioned voice note is still a voice note", () => {
  const described = describeMessage(
    message({ voice: { file_id: "v1" }, text: "typed", caption: "captioned" }),
  );
  assert.equal(described.kind, "voice");
  // `text` is preferred over `caption` when both somehow exist; either way the
  // media is what gets transcribed.
  assert.equal(described.text, "typed");
});

test("a document is media only when its mime type says so", () => {
  assert.equal(
    describeMessage(message({ document: { file_id: "d", mime_type: "audio/ogg" } })).media?.kind,
    "voice",
  );
  assert.equal(
    describeMessage(message({ document: { file_id: "d", mime_type: "video/mp4" } })).media?.kind,
    "video",
  );

  const pdf = describeMessage(
    message({ document: { file_id: "d", mime_type: "application/pdf" }, caption: "read this" }),
  );
  assert.equal(pdf.media, null);
  assert.equal(pdf.kind, "text");
  assert.equal(pdf.text, "read this");
});

test("media with no caption yields empty text, not undefined", () => {
  const described = describeMessage(message({ voice: { file_id: "v1" } }));
  assert.equal(described.text, "");
});
