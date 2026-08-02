/**
 * The one place a request is made to the fleet's own backend.
 *
 * Everything it does is boring on purpose: a bearer header, a JSON body, and an
 * error message a human can act on. It exists as its own module so that the
 * source (read-only, must never throw) and the review store (read/write, may
 * throw) share exactly one spelling of "how do we talk to it" — and so that the
 * token is attached in exactly one place.
 */

import type { BackendConfig } from "../../lib/backend";

export interface BackendRequest {
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export async function backendFetch<T>(
  backend: BackendConfig,
  request: BackendRequest,
): Promise<T> {
  const url = new URL(backend.url + request.path);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${backend.readToken}`,
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });

  if (!response.ok) {
    throw new Error(await describeFailure(response));
  }
  return (await response.json()) as T;
}

/**
 * Turn a status code into the sentence that names the fix.
 *
 * The backend answers `{ "error": "..." }` and that message is the useful one,
 * but a 401 deserves naming the *credential* rather than repeating "Invalid read
 * token" — the reader is looking at a dashboard, not at a backend log, and the
 * action is "open the gate and re-paste it".
 */
async function describeFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const error = (body as { error: unknown }).error;
      if (typeof error === "string") detail = error;
    }
  } catch {
    // Not JSON — a proxy or a cold deployment. The status alone will do.
  }

  if (response.status === 401) {
    return "the backend rejected the read token — re-paste it in the gate";
  }
  if (response.status === 503) {
    return detail === "" ? "the backend is not configured" : detail;
  }
  return detail === "" ? `the backend answered HTTP ${response.status}` : detail;
}
