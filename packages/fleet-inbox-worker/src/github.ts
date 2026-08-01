/**
 * The GitHub REST calls this worker makes, and how it discovers each repo's
 * initiatives.
 *
 * This client holds the only real power in the pipeline — a token that can
 * write issues to four repos. Everything it can do is here, in one file, so
 * "what can the inbox actually do to my repos" has a short answer: create an
 * issue, comment on one, add or remove a label, close one. It cannot push, it
 * cannot merge, it cannot read a private file outside `.fleet/`.
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

const API_ROOT = "https://api.github.com";

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
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const response = await fetch(API_ROOT + path, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
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
      throw new GitHubError(`GitHub ${response.status} for ${path}${detail}`, response.status);
    }

    // 204 No Content (label removal) has no body to parse.
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Initiatives declared by the repo, or derived from its `init:*` labels. */
  async listInitiatives(slug: string): Promise<Initiative[]> {
    try {
      const file = await this.request<{ content?: string }>(
        `/repos/${slug}/contents/.fleet/initiatives.json`,
      );
      if (file.content !== undefined) {
        return parseInitiativesFile(JSON.parse(decodeBase64Content(file.content)));
      }
    } catch (error) {
      // 404 is the common, expected case: most repos have no `.fleet/` yet.
      // Anything else (403 on a repo outside the token's scope, a 5xx) is also
      // survivable — fall through to labels, and let that fail quietly too.
      if (!(error instanceof GitHubError)) throw error;
    }

    try {
      const labels = await this.request<Array<{ name: string }>>(
        `/repos/${slug}/labels?per_page=100`,
      );
      return labels
        .filter((label) => label.name.startsWith("init:"))
        .map((label) => ({ name: label.name.slice("init:".length) }))
        .filter((initiative) => initiative.name !== "");
    } catch (error) {
      if (error instanceof GitHubError) return [];
      throw error;
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
    return this.request<CreatedIssue>(`/repos/${slug}/issues`, {
      method: "POST",
      body: issue,
    });
  }

  async getIssue(slug: string, issueNumber: number): Promise<IssueSummary> {
    return this.request<IssueSummary>(`/repos/${slug}/issues/${issueNumber}`);
  }

  async addLabels(slug: string, issueNumber: number, labels: string[]): Promise<void> {
    await this.request(`/repos/${slug}/issues/${issueNumber}/labels`, {
      method: "POST",
      body: { labels },
    });
  }

  async removeLabel(slug: string, issueNumber: number, label: string): Promise<void> {
    try {
      await this.request(
        `/repos/${slug}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
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
    await this.request(`/repos/${slug}/issues/${issueNumber}/comments`, {
      method: "POST",
      body: { body },
    });
  }

  async closeIssue(slug: string, issueNumber: number): Promise<void> {
    await this.request(`/repos/${slug}/issues/${issueNumber}`, {
      method: "PATCH",
      body: { state: "closed", state_reason: "not_planned" },
    });
  }
}
