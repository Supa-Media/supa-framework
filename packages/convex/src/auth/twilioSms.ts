/**
 * A plain text through Twilio's Messaging API, worded by the app.
 *
 * Twilio Verify writes its own message and signs it with the Verify service's
 * name. An app sharing a service with another app cannot rely on changing
 * it per request (Twilio refused every send carrying `CustomFriendlyName` on
 * one shared service, 2026-10-09). An app
 * that wants its own wording sends the code itself through this, and keeps
 * the code it sent: see `phoneVerify`'s `check`, which then answers from the
 * app's own records instead of Verify.
 *
 * Keys: `TWILIO_ACCOUNT_SID` with `TWILIO_AUTH_TOKEN`, or an API key
 * (`TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`), and who it is from:
 * `TWILIO_FROM_NUMBER` (E.164) or `TWILIO_MESSAGING_SERVICE_SID`. With any
 * half missing, `twilioSmsKeys` answers `null`.
 */
import type { TwilioSendResult } from "./twilioVerify";

export interface TwilioSmsKeys {
  accountSid: string;
  /** The account's auth token, or the API key's secret when `apiKeySid` is set. */
  authToken: string;
  apiKeySid?: string;
  /** A sending number in E.164, or a Messaging Service SID (`MG…`). */
  from: { number: string } | { messagingServiceSid: string };
}

type Fetch = typeof fetch;

/** The keys from the environment, or `null` when any half is unset. */
export function twilioSmsKeys(env: Record<string, string | undefined> = process.env): TwilioSmsKeys | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  if (!accountSid) return null;
  const number = env.TWILIO_FROM_NUMBER?.trim();
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const from = messagingServiceSid ? { messagingServiceSid } : number ? { number } : null;
  if (from === null) return null;
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (authToken) return { accountSid, authToken, from };
  const apiKeySid = env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = env.TWILIO_API_KEY_SECRET?.trim();
  if (!apiKeySid || !apiKeySecret) return null;
  return { accountSid, authToken: apiKeySecret, apiKeySid, from };
}

/** Twilio's "invalid To number" and "not a mobile number" codes. */
const INVALID_TO = new Set([21211, 21614, 21612, 21408]);

/** Text `body` to `phone` (E.164). Never logs the number or the body. */
export async function sendTwilioSms(
  keys: TwilioSmsKeys,
  phone: string,
  body: string,
  fetchImpl: Fetch = fetch,
): Promise<TwilioSendResult> {
  const form: Record<string, string> = { To: phone, Body: body };
  if ("messagingServiceSid" in keys.from) form.MessagingServiceSid = keys.from.messagingServiceSid;
  else form.From = keys.from.number;
  const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${keys.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keys.apiKeySid ?? keys.accountSid}:${keys.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  if (response.ok) return { ok: true };
  const text = await response.text();
  let error: { code?: number } = {};
  try {
    error = JSON.parse(text) as { code?: number };
  } catch {
    // not JSON; the status alone is logged
  }
  console.error("Twilio SMS send failed", { status: response.status, code: error.code });
  if (response.status === 429 || error.code === 20429) return { ok: false, reason: "too_many" };
  if (error.code !== undefined && INVALID_TO.has(error.code)) return { ok: false, reason: "invalid_phone" };
  return { ok: false, reason: "failed" };
}
