import { ownerOf, type TokenMap } from "../../lib/tokens";
import type { RateLimitInfo } from "../types";

/**
 * A very small GitHub API client — REST + GraphQL, browser-only, no SDK.
 *
 * One client holds one token. A fine-grained PAT is scoped to a single resource
 * owner and the fleet spans three, so callers hold a `GitHubClients` (below) and
 * ask it for the client that covers a given repo.
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
  /** The resource owner this token is scoped to — stamped onto its budget. */
  private readonly owner: string;
  private latestRateLimit: RateLimitInfo | null = null;

  constructor(token: string, owner: string) {
    this.token = token;
    this.owner = owner;
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
      owner: this.owner,
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
   * REST write — POST / PATCH / PUT / DELETE.
   *
   * Separate from `rest()` rather than a parameter on it, because every
   * difference between them is a correctness rule this app depends on: a write
   * must never send `If-None-Match` (a 304 on a POST is nonsense), must never
   * be served from cache, and — critically — **invalidates** the cache, since
   * adding a label to an issue makes every cached search that mentioned that
   * issue wrong. Sharing one method would make forgetting any of the three a
   * one-character mistake.
   *
   * A 204 (the usual answer to a label delete or a workflow dispatch) resolves
   * to `null`.
   */
  async write<T>(
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const response = await fetch(API_ROOT + path, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    this.captureRateLimit(response.headers);

    if (!response.ok) {
      throw new GitHubError(await describeFailure(response, path), response.status);
    }

    // The read cache is keyed by path with no notion of what a write touched,
    // so the only safe invalidation is total. It costs one cold refresh.
    clearResponseCache();

    if (response.status === 204 || response.headers.get("content-length") === "0") return null;
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  /**
   * GraphQL POST, returning **both** halves of the answer.
   *
   * This shape exists because GitHub answers a partially-failed GraphQL request
   * with `HTTP 200` carrying `data` *and* `errors` — one null alias beside four
   * good ones. Verified live:
   *
   * ```
   * { "data": { "a": {…}, "b": null },
   *   "errors": [ { "type": "NOT_FOUND", "path": ["b"], … } ] }   HTTP 200
   * ```
   *
   * Collapsing that to `data` alone (which the previous version did whenever
   * `data` was non-nullish) means a five-issue approve where one node id is
   * stale resolves as a success and the screen reports five. Both callers need
   * the errors and they need them differently — the read path files them as
   * `snapshot.errors` so the Partial-data banner fires, the write path maps each
   * `path: ["addN"]` back to the issue it failed on — so neither can be served
   * by a method that decides on their behalf.
   */
  async graphqlRaw<T>(
    query: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GraphQlResult<T>> {
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

    const payload = (await response.json()) as {
      data?: T | null;
      errors?: GraphQlError[];
    };
    return {
      data: payload.data ?? null,
      errors: payload.errors ?? [],
      status: response.status,
    };
  }

  /**
   * GraphQL POST for callers that want all-or-nothing: **any** `errors` entry
   * throws, even alongside usable `data`.
   *
   * Used for the label-id lookups, where a partial answer has no useful
   * interpretation. Anything that batches work over many issues must use
   * `graphqlRaw` and report per-alias.
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const { data, errors, status } = await this.graphqlRaw<T>(query, variables, signal);
    if (errors.length > 0) {
      throw new GitHubError(errors.map((error) => error.message).join("; "), status);
    }
    if (data === null) throw new GitHubError("GitHub returned no data for the query.", status);
    return data;
  }
}

/**
 * One `GitHubClient` per resource owner, and the routing that picks between
 * them.
 *
 * This is the whole of multi-token support at the transport layer: every caller
 * already knows the repo it is talking about, and a repo slug already carries
 * its owner, so nothing above needs to hold a token or think about which one.
 *
 * An owner with no token resolves to `null` rather than to a client with an
 * empty `Authorization` header. The difference matters: an empty header is a
 * 401 per request — four banner lines saying "expired" about a token that was
 * never entered — while `null` is a state the UI can name ("no token for shyoh")
 * and act on.
 */
export class GitHubClients {
  private readonly byOwner = new Map<string, GitHubClient>();

  constructor(tokens: TokenMap) {
    for (const [owner, token] of Object.entries(tokens)) {
      if (token !== "") this.byOwner.set(owner.toLowerCase(), new GitHubClient(token, owner));
    }
  }

  /** The client for `owner`, or `null` when no token was supplied for it. */
  forOwner(owner: string): GitHubClient | null {
    return this.byOwner.get(owner.toLowerCase()) ?? null;
  }

  /** The client whose token covers an `owner/name` slug, or `null`. */
  forRepo(slug: string): GitHubClient | null {
    return this.forOwner(ownerOf(slug));
  }

  /**
   * The **tightest** remaining budget across the loaded tokens.
   *
   * Each token has its own hourly allowance, so there is no single fleet-wide
   * number to report. The one about to run out is the one that will break the
   * next refresh, and it is the only one worth a slot in the top bar; showing
   * the newest response's budget instead would make the header flicker between
   * three unrelated counters.
   */
  get rateLimit(): RateLimitInfo | null {
    let tightest: RateLimitInfo | null = null;
    for (const client of this.byOwner.values()) {
      const info = client.rateLimit;
      if (info === null) continue;
      if (tightest === null || info.remaining < tightest.remaining) tightest = info;
    }
    return tightest;
  }
}

/** One entry of a GraphQL `errors` array. `path` names the alias that failed. */
export interface GraphQlError {
  message: string;
  type?: string;
  path?: Array<string | number>;
}

export interface GraphQlResult<T> {
  /** `null` when the whole document failed; partial objects are normal. */
  data: T | null;
  errors: GraphQlError[];
  status: number;
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
