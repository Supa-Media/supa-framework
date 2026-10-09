/**
 * Twilio Verify, on its own: send a code to a phone, then check one.
 *
 * `createSupaAuth`'s phone provider uses Twilio Verify to *sign in* with a
 * phone. An app that signs in with email can still want to know a person holds
 * a phone: proof of a real person, or one identity across several sign-in
 * emails. These two calls are that, without a sign-in provider: Twilio keeps
 * the code, so the app stores no secret and only records the result.
 *
 * The keys are the provider's: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
 * `TWILIO_VERIFY_SERVICE_SID`. An API key works in place of the auth token:
 * `TWILIO_API_KEY_SID` with `TWILIO_API_KEY_SECRET`, which Twilio recommends
 * because it can be revoked on its own. With no usable pair, `twilioVerifyKeys`
 * answers `null`, and the app decides what that means. It should never mean
 * "verified".
 *
 * Twilio writes the text itself — "Your <name> verification code is: …" — and
 * `<name>` is the Verify service's friendly name. A service shared by several
 * apps would sign every app's codes with one app's name, so `friendlyName`
 * (or `TWILIO_VERIFY_FRIENDLY_NAME`) names the app per request instead, sent
 * as Twilio's `CustomFriendlyName`. Unset, the service's own name is used.
 */

export interface TwilioVerifyKeys {
  accountSid: string;
  /** The account's auth token, or the API key's secret when `apiKeySid` is set. */
  authToken: string;
  serviceSid: string;
  /** Set when signing requests with an API key rather than the auth token. */
  apiKeySid?: string;
  /** The name the texted code is signed with, in place of the service's own. */
  friendlyName?: string;
}

export type TwilioSendResult =
  | { ok: true }
  | { ok: false; reason: "invalid_phone" | "too_many" | "failed" };

/** `wrong` covers an expired or unknown code too: Twilio answers both with 404. */
export type TwilioCheckResult = "approved" | "wrong" | "too_many" | "failed";

type Fetch = typeof fetch;

/** The keys from the environment, or `null` when any is unset. */
export function twilioVerifyKeys(
  env: Record<string, string | undefined> = process.env,
): TwilioVerifyKeys | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!accountSid || !serviceSid) return null;
  const friendlyName = env.TWILIO_VERIFY_FRIENDLY_NAME?.trim();
  const named = friendlyName ? { friendlyName } : {};
  if (authToken) return { accountSid, authToken, serviceSid, ...named };
  const apiKeySid = env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = env.TWILIO_API_KEY_SECRET?.trim();
  if (!apiKeySid || !apiKeySecret) return null;
  return { accountSid, authToken: apiKeySecret, serviceSid, apiKeySid, ...named };
}

function request(keys: TwilioVerifyKeys, path: string, body: Record<string, string>, fetchImpl: Fetch) {
  return fetchImpl(`https://verify.twilio.com/v2/Services/${keys.serviceSid}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keys.apiKeySid ?? keys.accountSid}:${keys.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}

async function errorOf(response: Response): Promise<{ code?: number; message?: string }> {
  const text = await response.text();
  try {
    return JSON.parse(text) as { code?: number; message?: string };
  } catch {
    return { message: text };
  }
}

/** Twilio's "Max send attempts reached" and "Max check attempts reached". */
const TOO_MANY = new Set([60203, 60202]);

/** Text a code to `phone` (E.164). */
export async function sendTwilioVerification(
  keys: TwilioVerifyKeys,
  phone: string,
  fetchImpl: Fetch = fetch,
): Promise<TwilioSendResult> {
  const body: Record<string, string> = { To: phone, Channel: "sms" };
  const friendlyName = keys.friendlyName?.trim();
  if (friendlyName) body.CustomFriendlyName = friendlyName;
  const response = await request(keys, "Verifications", body, fetchImpl);
  if (response.ok) return { ok: true };
  const error = await errorOf(response);
  // Logged without the number: a phone number is personal data.
  console.error("Twilio Verify send failed", { status: response.status, code: error.code });
  if (error.code !== undefined && TOO_MANY.has(error.code)) return { ok: false, reason: "too_many" };
  if (error.code === 60200 || /invalid.*phone/i.test(error.message ?? "")) {
    return { ok: false, reason: "invalid_phone" };
  }
  return { ok: false, reason: "failed" };
}

/** Check a code typed for `phone`. Only `approved` means the person holds it. */
export async function checkTwilioVerification(
  keys: TwilioVerifyKeys,
  phone: string,
  code: string,
  fetchImpl: Fetch = fetch,
): Promise<TwilioCheckResult> {
  const response = await request(keys, "VerificationCheck", { To: phone, Code: code }, fetchImpl);
  if (response.status === 404) return "wrong";
  if (!response.ok) {
    const error = await errorOf(response);
    console.error("Twilio Verify check failed", { status: response.status, code: error.code });
    return error.code !== undefined && TOO_MANY.has(error.code) ? "too_many" : "failed";
  }
  const body = (await response.json()) as { status?: string; valid?: boolean };
  return body.status === "approved" && body.valid !== false ? "approved" : "wrong";
}
