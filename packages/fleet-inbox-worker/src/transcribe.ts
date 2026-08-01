/**
 * Speech to text, via Workers AI Whisper (`@cf/openai/whisper`).
 *
 * The honest bit: there is no ffmpeg in a Worker, so there is no way to
 * demux a video's audio track before transcription. This sends the container
 * bytes to Whisper as-is and lets it decide — which works for the plain
 * MP4/AAC a phone records and does not work for much else. When it doesn't,
 * this returns a failure the caller relays verbatim ("send a voice note or
 * type it") rather than pretending the video produced an empty transcript.
 * A silently-empty result would look identical to a voice note that recorded
 * nothing, and the owner would have no idea which happened.
 */

import type { Env } from "./env";
import type { TelegramClient, TelegramFileRef } from "./telegram";

/**
 * Telegram's Bot API refuses to serve a download over 20MB, regardless of what
 * it accepted from the sender. Checking here turns a confusing mid-download
 * failure into a specific message.
 */
export const MAX_TRANSCRIBE_BYTES = 20 * 1024 * 1024;

export type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export async function transcribe(
  env: Env,
  telegram: TelegramClient,
  media: { ref: TelegramFileRef; kind: "voice" | "video" },
): Promise<TranscriptionResult> {
  const declaredSize = media.ref.file_size;
  if (declaredSize !== undefined && declaredSize > MAX_TRANSCRIBE_BYTES) {
    return {
      ok: false,
      reason: `That ${media.kind} is ${(declaredSize / 1024 / 1024).toFixed(1)}MB — over the 20MB Telegram will hand me. Send a voice note, or type it.`,
    };
  }

  let audio: ArrayBuffer;
  try {
    audio = await telegram.downloadFile(media.ref.file_id);
  } catch (error) {
    return {
      ok: false,
      reason: `I couldn't download that ${media.kind} (${describeError(error)}). Send a voice note, or type it.`,
    };
  }

  if (audio.byteLength > MAX_TRANSCRIBE_BYTES) {
    return {
      ok: false,
      reason: `That ${media.kind} is too large to transcribe. Send a voice note, or type it.`,
    };
  }

  try {
    // Workers AI takes the audio as a plain byte array, not a Blob or a
    // base64 string. For a 20MB file that's a 20-million-element array —
    // expensive, and the reason the size cap above is not merely defensive.
    const result = await env.AI.run("@cf/openai/whisper", {
      audio: [...new Uint8Array(audio)],
    });

    const text = (result.text ?? "").trim();
    if (text === "") {
      return {
        ok: false,
        reason:
          media.kind === "video"
            ? "Workers AI couldn't get audio out of that video — the container is probably one Whisper can't decode. Send it as a voice note, or type it."
            : "That voice note came back empty — I couldn't hear anything in it.",
      };
    }
    return { ok: true, text };
  } catch (error) {
    return {
      ok: false,
      reason:
        media.kind === "video"
          ? `Workers AI couldn't transcribe that video (${describeError(error)}). Send a voice note, or type it.`
          : `Transcription failed (${describeError(error)}). Try again, or type it.`,
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
