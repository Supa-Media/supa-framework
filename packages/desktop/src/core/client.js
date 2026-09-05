/**
 * Turning one queued entry into one HTTP request, and nothing else.
 *
 * Thin on purpose. Every retry decision belongs to the outbox
 * (`./outbox.js`), every route belongs to the app, and this module's whole job
 * is one request and one result.
 *
 * ## What this file guarantees
 *
 * **The credential goes in a header and appears nowhere else.** Not in the
 * path, not in a query string, not in an error, not in a log. `postEntry`
 * builds its own error strings rather than passing the `fetch` failure through,
 * because a thrown `TypeError` from `fetch` can carry the request URL and a
 * future URL might carry a token.
 *
 * **No content is logged.** A result carries a code and a short message from
 * the server; it never carries the body that was sent.
 *
 * **A reply we cannot parse is retryable, and is never counted as a success.**
 * A captive portal answering `200` with a login page is the single most common
 * "the network is up but not really" on a laptop, and treating it as an
 * acknowledgement drops whatever was in that entry for good.
 */

/**
 * The four answers a queue needs to tell apart, as strings rather than status
 * codes so that a server which knows more than HTTP can say so in its body.
 */
export const ERROR_CODES = Object.freeze({
  /** The request will never be accepted as written. Park it. */
  invalid: "invalid",
  /** This client is not allowed to do this. Park it; a person must act. */
  forbidden: "forbidden",
  /** Someone else wrote first. Retryable — the app resolves and re-queues. */
  conflict: "conflict",
  /** Anything transient: offline, timeout, 5xx, a portal. Retryable. */
  unavailable: "unavailable",
});

/**
 * Map an HTTP status onto a code for a reply that did not carry one.
 *
 * The server always sends a code; a proxy, a captive portal and a load balancer
 * do not, and those are exactly the replies a laptop meets.
 */
export function defaultCodeForStatus(status) {
  if (status === 401 || status === 403) return ERROR_CODES.forbidden;
  if (status === 409 || status === 412) return ERROR_CODES.conflict;
  if (status === 400 || status === 422) return ERROR_CODES.invalid;
  return ERROR_CODES.unavailable;
}

/**
 * Which refusals are worth trying again.
 *
 * Anything unrecognised is treated as **retryable**: an unknown code is far
 * more likely to be a server this build has not caught up with than a permanent
 * refusal, and the cost of being wrong is a backoff rather than lost content.
 */
export function defaultRetryable(code) {
  return code !== ERROR_CODES.invalid && code !== ERROR_CODES.forbidden;
}

function refusal(code, message, retryable) {
  return { ok: false, code, message, retryable: retryable(code) };
}

/**
 * Post one outbox entry.
 *
 * @param {object} config
 * @param {string} config.baseUrl origin plus any fixed path, no trailing slash
 * @param {(entry: { kind: string, subjectId: string, body: Record<string, unknown> }) => string} config.route
 * @param {() => Promise<string | null>} config.token read at request time, so a
 *   re-connect takes effect without a restart, and `null` means "not connected
 *   yet" rather than "rejected"
 * @param {typeof fetch} [config.fetch]
 * @param {number} [config.timeoutMs] a hung socket must not wedge a drain
 * @param {(status: number) => string} [config.codeForStatus]
 * @param {(code: string) => boolean} [config.retryable]
 * @param {{ kind: string, subjectId: string, body: Record<string, unknown> }} entry
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string, retryable: boolean }>}
 */
export async function postEntry(config, entry) {
  const retryable = config.retryable ?? defaultRetryable;
  const codeForStatus = config.codeForStatus ?? defaultCodeForStatus;

  const token = await config.token();
  if (token === null || token === undefined) {
    // Not a rejection: this machine is simply not connected yet. The entry
    // waits in the queue until somebody connects it, which is the whole point
    // of having a queue.
    return refusal(ERROR_CODES.unavailable, "this machine is not connected yet", retryable);
  }

  const doFetch = config.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);

  try {
    const response = await doFetch(`${config.baseUrl}${config.route(entry)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(entry.body),
      signal: controller.signal,
    });

    if (response.ok) {
      // A 2xx that is not JSON is a proxy, not the server.
      try {
        await response.clone().json();
      } catch {
        return refusal(ERROR_CODES.unavailable, "the reply did not come from the server", retryable);
      }
      return { ok: true };
    }

    let code = codeForStatus(response.status);
    let message = `server answered ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string" && body.error !== "") code = body.error;
      if (typeof body?.message === "string" && body.message !== "") message = body.message;
    } catch {
      // Keep the status-derived code. An unparseable error body is common and
      // is not itself a reason to park somebody's work.
    }
    return { ok: false, code, message, retryable: retryable(code) };
  } catch (error) {
    // Deliberately not `String(error)`: a fetch failure's message can contain
    // the request URL, and this string is written to a log file.
    const aborted = error instanceof Error && error.name === "AbortError";
    return refusal(
      ERROR_CODES.unavailable,
      aborted ? "the request timed out" : "the network is unreachable",
      retryable,
    );
  } finally {
    clearTimeout(timeout);
  }
}
