/**
 * The Telegram Bot API surface this worker uses, plus the pure logic for
 * deciding what a given message actually is.
 *
 * `describeMessage` is separated from the client because "is this a voice note,
 * a forwarded text, or a video with a caption" is the branch everything else
 * hangs off, and it should be testable against a fixture rather than a live
 * bot.
 */

import type { InlineKeyboard } from "./callback";

const API_ROOT = "https://api.telegram.org";

/* -------------------------------------------------------------------------- */
/* Update shapes — only the fields this worker reads.                          */
/* -------------------------------------------------------------------------- */

export interface TelegramFileRef {
  file_id: string;
  file_size?: number;
  mime_type?: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  voice?: TelegramFileRef;
  audio?: TelegramFileRef;
  video?: TelegramFileRef;
  video_note?: TelegramFileRef;
  document?: TelegramFileRef;
  /** Present on forwarded messages (Bot API 7.0+). */
  forward_origin?: { type?: string };
  /** Legacy forward marker, still sent by some clients. */
  forward_date?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: {
    message_id: number;
    chat: TelegramChat;
    text?: string;
    reply_markup?: { inline_keyboard: InlineKeyboard };
  };
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  /** Posts to a channel the bot administers — same handling as a message. */
  channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/* -------------------------------------------------------------------------- */
/* Message classification (pure)                                               */
/* -------------------------------------------------------------------------- */

/** How the content reached the worker. Appears in the issue's source marker. */
export type MessageKind = "text" | "forward" | "voice" | "video";

export interface DescribedMessage {
  kind: MessageKind;
  /** Typed text or caption. Empty when the message is media with no caption. */
  text: string;
  /** The file to transcribe, when there is one. */
  media: { ref: TelegramFileRef; kind: "voice" | "video" } | null;
}

function isForward(message: TelegramMessage): boolean {
  return message.forward_origin !== undefined || message.forward_date !== undefined;
}

/**
 * Classify an incoming message.
 *
 * Order matters: audio-bearing media wins over text, because a voice note with
 * a caption is a voice note that happens to be annotated — the caption is
 * context for the transcript, not a separate item. A `document` is only treated
 * as media when its MIME type says audio or video; otherwise it's an attachment
 * this worker has nothing to do with, and its caption (if any) is the content.
 */
export function describeMessage(message: TelegramMessage): DescribedMessage {
  const text = (message.text ?? message.caption ?? "").trim();

  const voice = message.voice ?? message.audio;
  if (voice !== undefined) return { kind: "voice", text, media: { ref: voice, kind: "voice" } };

  const video = message.video ?? message.video_note;
  if (video !== undefined) return { kind: "video", text, media: { ref: video, kind: "video" } };

  const document = message.document;
  if (document !== undefined) {
    const mime = document.mime_type ?? "";
    if (mime.startsWith("audio/")) {
      return { kind: "voice", text, media: { ref: document, kind: "voice" } };
    }
    if (mime.startsWith("video/")) {
      return { kind: "video", text, media: { ref: document, kind: "video" } };
    }
  }

  return { kind: isForward(message) ? "forward" : "text", text, media: null };
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export class TelegramError extends Error {
  constructor(method: string, detail: string) {
    super(`Telegram ${method} failed: ${detail}`);
    this.name = "TelegramError";
  }
}

/**
 * Telegram's phrasing when an edit would leave the message byte-identical.
 * Not an error condition for us — see `editMessageText`.
 */
const NOT_MODIFIED = "message is not modified";

export class TelegramClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_ROOT}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!payload.ok) {
      throw new TelegramError(method, payload.description ?? `HTTP ${response.status}`);
    }
    return payload.result as T;
  }

  /**
   * Send a message as **plain text** — no `parse_mode`, deliberately.
   *
   * Every string that reaches here carries model-derived text: a dictated item
   * title, a plan-edit target, an issue title read back from GitHub. Under
   * `parse_mode: "Markdown"` a single unbalanced `_`, `*` or backtick — "rename
   * user_id to userId" is enough — makes Telegram reject the whole message with
   * `400 can't parse entities`.
   *
   * That failure lands in the worst possible place: `fileItems` has already
   * created the GitHub issues by the time the summary is sent, so the owner
   * ends up with proposals in four repos and no ✅ to press. Escaping every
   * interpolated value for MarkdownV2 would also work; plain text is the
   * cheaper correct answer, and it is the fleet's existing precedent —
   * `overnight.md` sends plain text for exactly this reason.
   */
  async sendMessage(
    chatId: string,
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(keyboard === undefined ? {} : { reply_markup: { inline_keyboard: keyboard } }),
    });
  }

  /**
   * Edit a message, treating "nothing changed" as success.
   *
   * Telegram rejects a no-op edit with `400 message is not modified`. That is
   * reachable from an ordinary double-press — a stale client render, or the
   * same message open on two devices — and letting it throw would skip
   * `answerCallbackQuery` (leaving the button spinning in the client) and fire
   * a spurious error DM. The decision itself has already been applied on
   * GitHub by this point; a redundant edit is not something the owner can act
   * on, so it is not something worth telling him about.
   */
  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    keyboard: InlineKeyboard,
  ): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      if (error instanceof TelegramError && error.message.includes(NOT_MODIFIED)) return;
      throw error;
    }
  }

  async answerCallbackQuery(id: string, text: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, text });
  }

  /**
   * Resolve a `file_id` to bytes.
   *
   * Two hops by design: `getFile` returns a path, and the path is fetched from
   * a different host (`api.telegram.org/file/bot…`). The bot API caps
   * downloads at 20MB regardless of what Telegram itself accepted from the
   * sender, so a large file fails here rather than in Whisper.
   *
   * The download URL embeds the bot token, and this is the one error path whose
   * message this package does not author — a runtime `fetch` rejection carries
   * whatever the runtime decided to say. Rather than depend on someone else's
   * error-message format never including the URL, the rejection is caught and
   * replaced with a message written here. The original is dropped, not logged:
   * the status codes above cover every case worth acting on.
   */
  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (file.file_path === undefined) {
      throw new TelegramError("getFile", "response carried no file_path");
    }

    let response: Response;
    try {
      response = await fetch(`${API_ROOT}/file/bot${this.token}/${file.file_path}`);
    } catch {
      throw new TelegramError("file download", "the network request failed");
    }

    if (!response.ok) {
      throw new TelegramError("file download", `HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }
}
