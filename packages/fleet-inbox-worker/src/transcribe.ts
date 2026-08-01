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
 * The cap is the **Worker's memory budget**, not Telegram's 20MB download
 * limit.
 *
 * Workers AI takes audio as a `number[]`, so every byte becomes a JS array
 * element — even as packed SMIs under pointer compression that is ~4 bytes
 * each, on top of the `ArrayBuffer` itself and whatever the AI binding needs to
 * serialise it across. At Telegram's 20MB the array alone approaches the
 * isolate's 128MB ceiling, and an OOM inside `ctx.waitUntil` kills the isolate
 * **after** the 200 has already been returned: the owner gets nothing at all.
 * That is exactly the silent failure the video path is written to avoid,
 * reintroduced through a different door.
 *
 * 5MB is several minutes of opus (a real voice note is roughly 1MB/minute), so
 * this only ever bites the video path — which is the path where "send a voice
 * note instead" is the honest answer anyway.
 */
export const MAX_TRANSCRIBE_BYTES = 5 * 1024 * 1024;

/**
 * Copy an `ArrayBuffer` into the `number[]` Workers AI wants.
 *
 * A preallocated loop rather than `[...new Uint8Array(buf)]` for two reasons:
 * spread pushes every element through argument-list machinery, and
 * array-literal spread grows its backing store by repeated reallocation, so
 * peak memory transiently exceeds the finished array. Preallocating the exact
 * length avoids both. This is still O(n) memory — the cap above is what
 * actually keeps it inside the isolate.
 */
export function toAudioArray(buffer: ArrayBuffer): number[] {
  const bytes = new Uint8Array(buffer);
  const audio = new Array<number>(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) audio[i] = bytes[i] as number;
  return audio;
}

export type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export async function transcribe(
  env: Env,
  telegram: TelegramClient,
  media: { ref: TelegramFileRef; kind: "voice" | "video" },
): Promise<TranscriptionResult> {
  const limitMb = MAX_TRANSCRIBE_BYTES / 1024 / 1024;
  const declaredSize = media.ref.file_size;
  if (declaredSize !== undefined && declaredSize > MAX_TRANSCRIBE_BYTES) {
    return {
      ok: false,
      reason: `That ${media.kind} is ${(declaredSize / 1024 / 1024).toFixed(1)}MB — over the ${limitMb}MB I can hold in memory while transcribing. Send a voice note, or type it.`,
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

  // `file_size` is absent on some media, so the real bytes are re-checked here
  // — this is the check that actually protects the isolate.
  if (audio.byteLength > MAX_TRANSCRIBE_BYTES) {
    return {
      ok: false,
      reason: `That ${media.kind} is ${(audio.byteLength / 1024 / 1024).toFixed(1)}MB — over the ${limitMb}MB I can hold in memory while transcribing. Send a voice note, or type it.`,
    };
  }

  try {
    const result = await env.AI.run("@cf/openai/whisper", {
      audio: toAudioArray(audio),
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
