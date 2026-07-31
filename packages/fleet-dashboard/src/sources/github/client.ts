import type { RateLimitInfo } from "../types";

/**
 * A very small GitHub API client — REST + GraphQL, browser-only, no SDK.
 *
 * Two things it does that a plain `fetch` wrapper doesn't:
 *
 *  1. **Conditional requests.** Every REST GET stores its `ETag` and replays it
 *     as `If-None-Match`. GitHub answers `304 Not Modified` for unchanged
 *     resources and a 304 does NOT consume rate-limit budget. Refreshing a
 *     four-repo fleet every few minutes therefore costs almost nothing once
 *     warm. The cache lives in `sessionStorage`, so it survives a refresh but
 *     not a new browser session (avoiding unbounded growth in localStorage,
 *     which holds the token).
 *
 *  2. **Rate-limit surfacing.** The newest `x-ratelimit-*` headers are kept so
 *     the header can show remaining budget instead of the user discovering it
 *     via a wall of 403s.
 *
 * The token never leaves the browser: requests go straight to api.github.com,
 * there is no backend, and the token is read from localStorage at call time.
 */

const API_ROOT = "https://api.github.com";
const CACHE_PREFIX = "fleet-dashboard:etag:";

export class GitHubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

interface CachedResponse {
  etag: string;
  body: unknown;
}

function readCache(key: string): CachedResponse | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as CachedResponse);
  } catch {
    return null;
  }
}

function writeCache(key: string, value: CachedResponse): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — conditional requests are an
    // optimization, so degrade to unconditional ones rather than failing.
  }
}

/**
 * Drop every cached response.
 *
 * Must be called on sign-out AND on sign-in, because the cache holds full REST
 * bodies — including private-repo workflow file contents — keyed by request
 * path with no reference to the token that authorized fetching them. Without
 * this, "Sign out" would leave the fleet's private data readable in
 * `sessionStorage`, and signing in with a different identity would serve the
 * previous account's bodies as 304 fallbacks.
 */
export function clearResponseCache(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key !== null && key.startsWith(CACHE_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) sessionStorage.removeItem(key);
  } catch {
    // Storage disabled — nothing was cached in the first place.
  }
}

/**
 * Percent-encode each segment of a repo-controlled path.
 *
 * Not an XSS fix — the scheme is always a fixed `https://` literal and React
 * escapes attributes. It fixes mundane breakage from filenames a repo can
 * legally contain: `#` truncates the ✎ deep link at the fragment, `?` injects
 * query parameters into the REST request, and a space or `%` breaks the
 * contents fetch outright so the gardener renders with no cron and no engine.
 */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class GitHubClient {
  private readonly token: string;
  private latestRateLimit: RateLimitInfo | null = null;

  constructor(token: string) {
    this.token = token;
  }

  get rateLimit(): RateLimitInfo | null {
    return this.latestRateLimit;
  }

  private captureRateLimit(headers: Headers): void {
    const remaining = headers.get("x-ratelimit-remaining");
    const limit = headers.get("x-ratelimit-limit");
    const reset = headers.get("x-ratelimit-reset");
    if (remaining === null || limit === null || reset === null) return;
    this.latestRateLimit = {
      remaining: Number(remaining),
      limit: Number(limit),
      resetAt: new Date(Number(reset) * 1000).toISOString(),
    };
  }

  /** REST GET with an `If-None-Match` conditional request. `path` starts with `/`. */
  async rest<T>(path: string, signal?: AbortSignal): Promise<T> {
    const cached = readCache(path);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (cached) headers["If-None-Match"] = cached.etag;

    const response = await fetch(API_ROOT + path, { headers, signal });
    this.captureRateLimit(response.headers);

    if (response.status === 304 && cached) return cached.body as T;

    if (!response.ok) {
      throw new GitHubError(await describeFailure(response, path), response.status);
    }

    const body = (await response.json()) as T;
    const etag = response.headers.get("etag");
    if (etag !== null) writeCache(path, { etag, body });
    return body;
  }

  /**
   * GraphQL POST. Not conditionally cached — GitHub doesn't ETag the GraphQL
   * endpoint — but one GraphQL call replaces dozens of REST ones, which is the
   * bigger rate-limit win.
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${API_ROOT}/graphql`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal,
    });
    this.captureRateLimit(response.headers);

    if (!response.ok) {
      throw new GitHubError(await describeFailure(response, "/graphql"), response.status);
    }

    const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (payload.errors && payload.errors.length > 0) {
      // Partial data is common (one repo the token can't see); surface the
      // message but still return whatever came back.
      if (payload.data === undefined || payload.data === null) {
        throw new GitHubError(
          payload.errors.map((error) => error.message).join("; "),
          response.status,
        );
      }
    }
    return payload.data as T;
  }
}

async function describeFailure(response: Response, path: string): Promise<string> {
  if (response.status === 401) return "GitHub rejected the token (401). Check it hasn't expired.";
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    return "GitHub rate limit exhausted. Wait for the reset shown in the header.";
  }
  if (response.status === 403) return `No access to ${path} (403) — check the token's repository scope.`;
  if (response.status === 404) return `Not found: ${path} (404).`;

  let detail = "";
  try {
    const body = (await response.json()) as { message?: string };
    detail = body.message ? ` — ${body.message}` : "";
  } catch {
    // Non-JSON error body; the status alone is enough.
  }
  return `GitHub ${response.status} for ${path}${detail}`;
}

/** Decode a REST `contents` API base64 payload (which wraps lines at 60 chars). */
export function decodeBase64Content(encoded: string): string {
  const binary = atob(encoded.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
