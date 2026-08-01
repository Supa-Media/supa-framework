import type { FleetWriter } from "../types";
import { clearResponseCache, encodePath, GitHubClient } from "./client";
import { buildAddLabelMutation, LABEL_ID_QUERY } from "./queries";

/**
 * The four verbs the dashboard is allowed to speak: label, comment, file an
 * issue, dispatch a workflow.
 *
 * Nothing here merges a PR, edits a file, or changes a workflow. That is not an
 * oversight — the review screen's whole claim is that the UI holds no power the
 * audit trail doesn't already record. A label change and a comment are both
 * visible in an issue's timeline forever; a merge performed by a dashboard is
 * a merge nobody can attribute later.
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

  async function labelId(slug: string, label: string): Promise<string> {
    const cacheKey = `${slug}:${label}`;
    const known = labelIds.get(cacheKey);
    if (known !== undefined) return known;

    const [owner, name] = split(slug);
    const data = await client.graphql<{
      repository: { label: { id: string } | null } | null;
    }>(LABEL_ID_QUERY, { owner, name, label });

    const id = data.repository?.label?.id;
    if (id === undefined || id === null) {
      // Creating the label silently would be the wrong kindness: a typo'd
      // convention would spread across the fleet one approval at a time, and
      // the queue would go quiet with no visible cause.
      throw new Error(`${slug} has no label "${label}" — create it in the repo first.`);
    }
    labelIds.set(cacheKey, id);
    return id;
  }

  return {
    async addLabels(slug, issueNumber, labels) {
      if (labels.length === 0) return;
      await client.write("POST", `/repos/${slug}/issues/${issueNumber}/labels`, { labels });
    },

    async removeLabel(slug, issueNumber, label) {
      // A label name can contain `/`, `#`, and spaces, all of which break a
      // naively-interpolated path — `agent:ready` is fine, `size:M/L` is not.
      await client.write(
        "DELETE",
        `/repos/${slug}/issues/${issueNumber}/labels/${encodePath(label)}`,
      );
    },

    async addLabelToMany(slug, nodeIds, label) {
      if (nodeIds.length === 0) return;

      const id = await labelId(slug, label);
      const variables: Record<string, unknown> = { labelId: id };
      nodeIds.forEach((nodeId, index) => {
        variables[`target${index}`] = nodeId;
      });

      await client.graphql(buildAddLabelMutation(nodeIds.length), variables);
      // `graphql()` has no cache to invalidate of its own, but the REST reads
      // that mention these issues do.
      clearResponseCache();
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
      const created = await client.write<{ html_url: string; number: number }>(
        "POST",
        `/repos/${slug}/issues`,
        issue,
      );
      if (created === null) throw new Error("GitHub accepted the issue but returned no body.");
      return { url: created.html_url, number: created.number };
    },

    async dispatchWorkflow(slug, workflowFile, ref, inputs) {
      await client.write(
        "POST",
        `/repos/${slug}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
        { ref, inputs },
      );
    },
  };
}
