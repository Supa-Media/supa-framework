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

  async sendMessage(
    chatId: string,
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...(keyboard === undefined ? {} : { reply_markup: { inline_keyboard: keyboard } }),
    });
  }

  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    keyboard: InlineKeyboard,
  ): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard },
    });
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
   * sender, so a large video fails here rather than in Whisper.
   */
  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (file.file_path === undefined) {
      throw new TelegramError("getFile", "response carried no file_path");
    }

    const response = await fetch(`${API_ROOT}/file/bot${this.token}/${file.file_path}`);
    if (!response.ok) {
      throw new TelegramError("file download", `HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }
}
