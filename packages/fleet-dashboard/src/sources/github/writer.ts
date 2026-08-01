import type { FleetWriter, LabelBatchOutcome } from "../types";
import { clearResponseCache, encodePath, GitHubClient } from "./client";
import { buildAddLabelMutation, buildLabelIdsQuery, MAX_APPROVE_BATCH } from "./queries";

/**
 * The three verbs the dashboard is allowed to speak: label, comment, file an
 * issue.
 *
 * Nothing here merges a PR, edits a file, changes a workflow, or **runs** one.
 * That is not an oversight — the review screen's whole claim is that the UI
 * holds no power the audit trail doesn't already record. A label change and a
 * comment are both visible in an issue's timeline forever; a merge performed by
 * a dashboard is a merge nobody can attribute later.
 *
 * `dispatchWorkflow` was the fourth verb in the first draft of v2, for the
 * Secrets view's "run sync ▶". It is gone: a fine-grained PAT cannot grant
 * dispatch on one workflow, only `Actions: Read and write` on the whole repo —
 * which would let a token sitting in localStorage fire every production deploy
 * in the fleet, to buy one button. The button is now a deep link to GitHub's own
 * dispatch form, where the run is attributed to a session GitHub authenticated.
 */
export function createGitHubWriter(token: string): FleetWriter {
  const client = new GitHubClient(token);

  /** `owner/name` → `["owner", "name"]`, for GraphQL's split arguments. */
  const split = (slug: string): [string, string] => {
    const [owner, name] = slug.split("/");
    if (owner === undefined || name === undefined || name === "") {
      throw new Error(`"${slug}" is not an owner/name repo slug`);
    }
    return [owner, name];
  };

  const labelIds = new Map<string, string>();

  /**
   * Resolve label names to node ids, throwing on the first one the repo doesn't
   * have.
   *
   * Every write that carries a label name calls this — including the REST ones,
   * which is the whole point. `POST /issues/:n/labels` and `POST /issues` both
   * **create** an unknown label rather than rejecting it, so without this check
   * the guarantee held on exactly one of seven write paths: a typo'd convention
   * would spread across the fleet one approval at a time, and the queue would go
   * quiet with no visible cause.
   *
   * One round-trip for the whole set, and cached per `slug:label` for the
   * session — the vocabulary is nine names, so the cache is warm after the first
   * couple of writes.
   */
  async function resolveLabels(slug: string, labels: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(labels)];
    const missing = wanted.filter((label) => !labelIds.has(`${slug}:${label}`));

    if (missing.length > 0) {
      const [owner, name] = split(slug);
      const variables: Record<string, unknown> = { owner, name };
      missing.forEach((label, index) => {
        variables[`label${index}`] = label;
      });

      const data = await client.graphql<{
        repository: (Record<string, { id: string } | null> & { __typename?: string }) | null;
      }>(buildLabelIdsQuery(missing.length), variables);

      const absent: string[] = [];
      missing.forEach((label, index) => {
        const id = data.repository?.[`l${index}`]?.id;
        if (typeof id === "string") labelIds.set(`${slug}:${label}`, id);
        else absent.push(label);
      });

      if (absent.length > 0) {
        throw new Error(
          `${slug} has no label ${absent.map((label) => `"${label}"`).join(", ")} — create it in the repo first.`,
        );
      }
    }

    return wanted.map((label) => labelIds.get(`${slug}:${label}`) as string);
  }

  /** `add3` → 3. Anything else (a document-level error) → `null`. */
  function aliasIndex(path: Array<string | number> | undefined): number | null {
    const head = path?.[0];
    if (typeof head !== "string") return null;
    const match = /^add(\d+)$/.exec(head);
    return match === null ? null : Number(match[1]);
  }

  return {
    async addLabels(slug, issueNumber, labels) {
      if (labels.length === 0) return;
      await resolveLabels(slug, labels);
      await client.write("POST", `/repos/${slug}/issues/${issueNumber}/labels`, { labels });
    },

    async removeLabel(slug, issueNumber, label) {
      // A label name can contain `/`, `#`, and spaces, all of which break a
      // naively-interpolated path — `agent:ready` is fine, `size:M/L` is not.
      // No existence check: removing a label that isn't there is a 404, and
      // nothing is created either way.
      await client.write(
        "DELETE",
        `/repos/${slug}/issues/${issueNumber}/labels/${encodePath(label)}`,
      );
    },

    async addLabelToMany(slug, nodeIds, label) {
      const outcome: LabelBatchOutcome = { labelled: [], failed: [] };
      if (nodeIds.length === 0) return outcome;

      const [id] = await resolveLabels(slug, [label]);

      for (let start = 0; start < nodeIds.length; start += MAX_APPROVE_BATCH) {
        const chunk = nodeIds.slice(start, start + MAX_APPROVE_BATCH);
        const variables: Record<string, unknown> = { labelId: id };
        chunk.forEach((nodeId, index) => {
          variables[`target${index}`] = nodeId;
        });

        const { data, errors } = await client.graphqlRaw<Record<string, unknown>>(
          buildAddLabelMutation(chunk.length),
          variables,
        );

        // A 200 carrying `data` AND `errors` is how GitHub reports "three of
        // five worked". Map each failing alias back to the issue it names;
        // anything unattributable (a rate-limit or a document error) fails the
        // whole chunk, because we cannot tell which of its aliases ran.
        const failed = new Map<number, string>();
        const chunkWide: string[] = [];
        for (const error of errors) {
          const index = aliasIndex(error.path);
          if (index === null || index >= chunk.length) chunkWide.push(error.message);
          else failed.set(index, error.message);
        }
        if (data === null && chunkWide.length === 0) {
          chunkWide.push("GitHub returned no data for the approve mutation.");
        }

        chunk.forEach((nodeId, index) => {
          const message = chunkWide.length > 0 ? chunkWide.join("; ") : failed.get(index);
          if (message === undefined) outcome.labelled.push(nodeId);
          else outcome.failed.push({ nodeId, message });
        });
      }

      // `graphql()` has no cache to invalidate of its own, but the REST reads
      // that mention these issues do.
      clearResponseCache();
      return outcome;
    },

    async comment(slug, issueNumber, body) {
      await client.write("POST", `/repos/${slug}/issues/${issueNumber}/comments`, { body });
    },

    async closeIssue(slug, issueNumber, comment) {
      // Comment first. If the close succeeded and the comment then failed, the
      // issue would be shut with no stated reason — the one outcome that is
      // worse than the action not happening at all.
      if (comment !== null && comment.trim() !== "") {
        await client.write("POST", `/repos/${slug}/issues/${issueNumber}/comments`, {
          body: comment,
        });
      }
      await client.write("PATCH", `/repos/${slug}/issues/${issueNumber}`, {
        state: "closed",
        state_reason: "not_planned",
      });
    },

    async createIssue(slug, issue) {
      // Checked before the POST, not by it: `POST /issues` creates any label it
      // is handed. Filing is the path a typo is most likely to arrive on,
      // because the labels come from a palette action rather than an issue that
      // already carries them.
      await resolveLabels(slug, issue.labels);
      const created = await client.write<{ html_url: string; number: number }>(
        "POST",
        `/repos/${slug}/issues`,
        issue,
      );
      if (created === null) throw new Error("GitHub accepted the issue but returned no body.");
      return { url: created.html_url, number: created.number };
    },
  };
}
