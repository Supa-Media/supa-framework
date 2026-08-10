/**
 * The GitHub REST calls this worker makes, and how it discovers each repo's
 * initiatives.
 *
 * This client holds the only real power in the pipeline — tokens that can
 * write issues to four repos. Everything it can do is here, in one file, so
 * "what can the inbox actually do to my repos" has a short answer: create an
 * issue, comment on one, add or remove a label, close one. It cannot push, it
 * cannot merge, it cannot read a private file outside `.fleet/`.
 *
 * **Tokens, plural.** A fine-grained GitHub PAT is scoped to exactly one
 * *resource owner*, and the fleet spans three — `togathernyc`, `Supa-Media`,
 * `shyoh`. So there is no single fine-grained token that reaches all four
 * repos, and every request is routed to the token for the owner half of its
 * slug. See {@link githubTokens} for where those come from.
 *
 * Initiative discovery has two sources, in order:
 *
 *  1. `.fleet/initiatives.json` in the repo, if present — the repo declaring
 *     its own initiatives, with descriptions the extraction model can route on.
 *  2. Otherwise, the repo's `init:*` labels — which exist already, because
 *     that's what this worker files against.
 *
 * A repo the token can't see (404/403) contributes an empty list rather than
 * failing the whole extraction. One unreachable repo shouldn't cost the owner
 * a voice note.
 */

import { FLEET_APPS, UNASSIGNED_SLUG } from "./fleet";
import { errorName, log } from "./log";
import type { Env } from "./env";

const API_ROOT = "https://api.github.com";

/* -------------------------------------------------------------------------- */
/* Which token talks to which repo                                             */
/* -------------------------------------------------------------------------- */

/** Resource owner (lowercased) → the token that can reach that owner's repos. */
export type TokenMap = Record<string, string>;

/**
 * The `owner` half of an `owner/name` slug, lowercased.
 *
 * Lowercased because GitHub logins are case-insensitive and `fleet.ts` spells
 * `Supa-Media` the way GitHub displays it — a lookup that respected case would
 * miss the repo for no reason a reader could see.
 */
export function ownerOf(slug: string): string {
  return (slug.split("/")[0] ?? "").toLowerCase();
}

/**
 * The secret name holding one owner's token: `GH_TOKEN_` plus the owner
 * uppercased, with every non-alphanumeric character an underscore. So
 * `togathernyc` → `GH_TOKEN_TOGATHERNYC` and `Supa-Media` → `GH_TOKEN_SUPA_MEDIA`.
 */
export function tokenEnvKey(owner: string): `GH_TOKEN_${string}` {
  return `GH_TOKEN_${owner.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/**
 * Resolve one token per fleet owner from the worker's secrets.
 *
 * `GH_TOKEN_<OWNER>` wins; `GH_TOKEN` is the fallback for any owner without
 * one, which is all a classic (non-fine-grained) PAT needs — it already spans
 * every owner the account can reach. An owner with neither is simply absent
 * from the map, and a request for its repos fails with a message naming the
 * secret to set rather than a confusing 404 from GitHub.
 */
export function githubTokens(env: Env): TokenMap {
  const tokens: TokenMap = {};
  const fallback = (env.GH_TOKEN ?? "").trim();

  for (const slug of [...FLEET_APPS.map((app) => app.slug), UNASSIGNED_SLUG]) {
    const owner = ownerOf(slug);
    const perOwner = (env[tokenEnvKey(owner)] ?? "").trim();
    const token = perOwner === "" ? fallback : perOwner;
    if (token !== "") tokens[owner] = token;
  }
  return tokens;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export interface Initiative {
  name: string;
  description?: string;
}

export interface CreatedIssue {
  number: number;
  html_url: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  html_url: string;
  /**
   * Label names. Load-bearing: the keep path refuses to promote an issue that
   * isn't currently `inbox:proposed`, which is what stops a forged callback
   * from stamping `agent:ready` onto an arbitrary issue number.
   */
  labels: string[];
}

/**
 * Parse `.fleet/initiatives.json`, accepting the three shapes a human would
 * plausibly write by hand.
 *
 * Exported for tests — the file is repo-authored, so it's the input most likely
 * to arrive in an unexpected shape.
 */
export function parseInitiativesFile(raw: unknown): Initiative[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { initiatives?: unknown }).initiatives)
      ? ((raw as { initiatives: unknown[] }).initiatives)
      : [];

  const initiatives: Initiative[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name !== "") initiatives.push({ name });
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>;
      const name = typeof record["name"] === "string" ? record["name"].trim() : "";
      if (name === "") continue;
      const description =
        typeof record["description"] === "string" ? record["description"].trim() : undefined;
      initiatives.push(description === undefined || description === "" ? { name } : { name, description });
    }
  }
  return initiatives;
}

/** Decode a REST `contents` base64 payload (GitHub wraps lines at 60 chars). */
function decodeBase64Content(encoded: string): string {
  const binary = atob(encoded.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubClient {
  private readonly tokens: TokenMap;

  constructor(tokens: TokenMap) {
    this.tokens = tokens;
  }

  /**
   * One REST call against `slug`, signed with that repo owner's token.
   *
   * `path` is the part after `/repos/{slug}`, so the slug appears once and the
   * token lookup cannot drift from the repo actually being called.
   */
  private async request<T>(
    slug: string,
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const owner = ownerOf(slug);
    const token = this.tokens[owner];
    if (token === undefined) {
      // Not a GitHubError: nothing was asked of GitHub. This message reaches
      // the owner as a Telegram DM, so it names the fix.
      throw new Error(
        `No GitHub token for ${owner} — set ${tokenEnvKey(owner)} (or GH_TOKEN).`,
      );
    }

    const response = await fetch(`${API_ROOT}/repos/${slug}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "supa-fleet-inbox-worker",
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { message?: string };
        detail = body.message === undefined ? "" : ` — ${body.message}`;
      } catch {
        // Non-JSON error body; the status alone is enough.
      }
      throw new GitHubError(
        `GitHub ${response.status} for /repos/${slug}${path}${detail}`,
        response.status,
      );
    }

    // 204 No Content (label removal) has no body to parse.
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * Initiatives declared by the repo, or derived from its `init:*` labels.
   *
   * **Nothing in here throws.** Both stages swallow everything, not just
   * `GitHubError`: `.fleet/initiatives.json` is a repo-authored file, so a
   * malformed one raises a `SyntaxError` from `JSON.parse` and a corrupt
   * base64 payload raises from `atob` — neither is a GitHub error, and an
   * earlier version rethrew both. Since the caller fans these out across four
   * repos, that meant one repo's bad file killed every voice note, including
   * ones that had nothing to do with that repo. `parseInitiativesFile` already
   * treats this file as untrusted input; the parse belongs inside the same
   * tolerance.
   *
   * Swallowing is not the same as staying quiet, though: a repo whose
   * `.fleet/initiatives.json` has been malformed for a month routes worse than
   * it should, forever, and the only way anyone finds out is a log line. Both
   * catches emit one — bar the 404 that just means "this repo has no
   * `.fleet/` yet", which is the normal case and would drown the signal.
   */
  async listInitiatives(slug: string): Promise<Initiative[]> {
    try {
      const file = await this.request<{ content?: string }>(
        slug,
        "/contents/.fleet/initiatives.json",
      );
      if (file.content !== undefined) {
        return parseInitiativesFile(JSON.parse(decodeBase64Content(file.content)));
      }
    } catch (error) {
      // A 403 (repo outside the token's scope), a 5xx, a malformed file, or a
      // corrupt payload are all equally survivable: fall through to labels.
      if (!(error instanceof GitHubError && error.status === 404)) {
        log("initiatives.file_unreadable", { repo: slug, error: errorName(error) });
      }
    }

    try {
      const labels = await this.request<Array<{ name: string }>>(
        slug,
        "/labels?per_page=100",
      );
      return labels
        .filter((label) => label.name.startsWith("init:"))
        .map((label) => ({ name: label.name.slice("init:".length) }))
        .filter((initiative) => initiative.name !== "");
    } catch (error) {
      // No initiatives for this repo at all. The extraction prompt says so
      // explicitly ("no initiatives declared yet") rather than pretending the
      // repo has none — but routing for this app is degraded until it's fixed.
      log("initiatives.unavailable", { repo: slug, error: errorName(error) });
      return [];
    }
  }

  /**
   * File an issue.
   *
   * Labels that don't exist yet are created by GitHub as a side effect of this
   * call — which is how `inbox:proposed` and a brand-new `init:*` come into
   * existence without a separate provisioning step.
   */
  async createIssue(
    slug: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<CreatedIssue> {
    return this.request<CreatedIssue>(slug, "/issues", {
      method: "POST",
      body: issue,
    });
  }

  async getIssue(slug: string, issueNumber: number): Promise<IssueSummary> {
    const issue = await this.request<{
      number: number;
      title: string;
      html_url: string;
      labels?: Array<{ name?: string } | string>;
    }>(slug, `/issues/${issueNumber}`);

    // GitHub returns label objects, but the same field is a bare string array
    // in some older payloads. Normalize so callers can just check membership.
    const labels = (issue.labels ?? [])
      .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
      .filter((name) => name !== "");

    return { number: issue.number, title: issue.title, html_url: issue.html_url, labels };
  }

  async addLabels(slug: string, issueNumber: number, labels: string[]): Promise<void> {
    await this.request(slug, `/issues/${issueNumber}/labels`, {
      method: "POST",
      body: { labels },
    });
  }

  async removeLabel(slug: string, issueNumber: number, label: string): Promise<void> {
    try {
      await this.request(
        slug,
        `/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      // The label already being absent is success, not failure — this path runs
      // when the owner taps ✅ on an issue somebody already relabelled.
      if (error instanceof GitHubError && error.status === 404) return;
      throw error;
    }
  }

  async comment(slug: string, issueNumber: number, body: string): Promise<void> {
    await this.request(slug, `/issues/${issueNumber}/comments`, {
      method: "POST",
      body: { body },
    });
  }

  async closeIssue(slug: string, issueNumber: number): Promise<void> {
    await this.request(slug, `/issues/${issueNumber}`, {
      method: "PATCH",
      body: { state: "closed", state_reason: "not_planned" },
    });
  }
}
