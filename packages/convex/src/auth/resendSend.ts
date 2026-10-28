/**
 * One email through Resend's HTTP API, logging a refusal without its body.
 *
 * Resend's error body is text we do not control. It can name the recipient,
 * and an error page in front of the API could echo anything sent to it,
 * including the message, which carries the sign-in code. So a refusal is
 * logged as the HTTP status and Resend's error `name`, and only when that name
 * is one of Resend's documented ones; anything else is `other`. The body is
 * never printed, whatever it says.
 *
 * The caller sees the same thing it always did: a thrown error with a fixed,
 * human message.
 */

/** Resend's documented error names. Anything else is logged as `other`. */
const RESEND_ERROR_NAMES = new Set([
  "application_error",
  "concurrent_idempotent_requests",
  "daily_quota_exceeded",
  "internal_server_error",
  "invalid_access",
  "invalid_api_Key",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "invalid_parameter",
  "invalid_region",
  "method_not_allowed",
  "missing_api_key",
  "missing_required_field",
  "monthly_quota_exceeded",
  "not_found",
  "rate_limit_exceeded",
  "restricted_api_key",
  "security_error",
  "validation_error",
]);

export const RESEND_SEND_FAILED = "Failed to send verification email. Please try again.";

/** The one line a refused send is logged as: a status and a known category. */
export async function resendFailure(response: Response): Promise<{ status: number; category: string }> {
  let category = "other";
  try {
    const name = (JSON.parse(await response.text()) as { name?: unknown }).name;
    if (typeof name === "string" && RESEND_ERROR_NAMES.has(name)) category = name;
  } catch {
    // Not JSON, or not readable: still `other`.
  }
  return { status: response.status, category };
}

export interface ResendEmail {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}

export async function sendResendEmail(
  email: ResendEmail,
  send: typeof fetch = fetch,
  log: (message: string, fields: { status: number; category: string }) => void = (message, fields) =>
    console.error(message, fields),
): Promise<void> {
  const response = await send("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${email.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: email.from, to: email.to, subject: email.subject, html: email.html }),
  });
  if (!response.ok) {
    log("Resend email send failed", await resendFailure(response));
    throw new Error(RESEND_SEND_FAILED);
  }
}
