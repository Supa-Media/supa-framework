import { findMarker } from "../lib/markers";
import { MARKER_CONTEXT_SHEET, selectInProgress } from "../lib/select";
import { age } from "../lib/time";
import type { PrState } from "../sources/types";
import { Dot, Empty, Group, Pill, Row, Rows, ViewHeader, type Tone } from "../components/ui";
import type { Ctx } from "./context";

const STATE_LABEL: Record<PrState, string> = {
  draft: "draft",
  "ci-running": "CI running",
  "ci-failed": "CI failed",
  conflict: "conflict",
  review: "review",
  mergeable: "mergeable",
};

const STATE_TONE: Record<PrState, Tone> = {
  draft: "n",
  "ci-running": "y",
  "ci-failed": "r",
  conflict: "r",
  review: "p",
  mergeable: "g",
};

/**
 * ◉ Now — live sessions, for when you choose to watch.
 *
 * There is no agent telemetry to read (no backend), so a "session" is the
 * closest honest proxy the GitHub API offers: an `agent:in-progress` issue, or
 * an open PR that moved recently. Both are grouped by repo, and a PR that is
 * blocked says what on.
 *
 * The ritual never requires this screen. It exists for the ten minutes a day
 * you want to look.
 */
export function Now({ ctx }: { ctx: Ctx }) {
  const working = selectInProgress(ctx.snapshot.issues);
  const active = ctx.snapshot.projects
    .map((project) => ({
      project,
      prs: project.initiatives
        .flatMap((initiative) => initiative.prs)
        .filter((pr) => !pr.isDraft)
        .slice(0, 8),
    }))
    .filter((entry) => entry.prs.length > 0);

  return (
    <>
      <ViewHeader
        title="Now"
        sub="live sessions and open PRs — the ritual never requires this screen"
      />

      {working.length === 0 && active.length === 0 ? (
        <Empty>
          <b>Nothing in flight.</b> No issue is labelled <code>agent:in-progress</code> and no repo
          has an open pull request.
        </Empty>
      ) : (
        <>
          {working.map((group) => (
            <Rows key={group.repoKey}>
              <Group
                right={
                  <>
                    <Dot tone="g" pulse /> {group.issues.length} working
                  </>
                }
              >
                {group.repoLabel} · in progress
              </Group>
              {group.issues.map((issue) => {
                const sheet = findMarker(
                  issue.comments[issue.comments.length - 1]?.body ?? "",
                  MARKER_CONTEXT_SHEET,
                );
                return (
                  <Row key={issue.id}>
                    <span className="grow">
                      <a href={issue.url} target="_blank" rel="noreferrer">
                        {issue.title}
                      </a>
                      <span className="sm">
                        #{issue.number} · updated {age(issue.updatedAt)} ago
                        {issue.initiatives.length > 0 && ` · ${issue.initiatives.join(", ")}`}
                        {sheet !== null && " · respawned with a context sheet"}
                      </span>
                    </span>
                    {issue.notify && <Pill tone="y">⚡</Pill>}
                    {issue.automerge && <Pill tone="g">automerge</Pill>}
                  </Row>
                );
              })}
            </Rows>
          ))}

          {active.map(({ project, prs }) => (
            <Rows key={project.key}>
              <Group
                right={`${project.openPrs} open${project.fetchedPrs < project.openPrs ? ` · showing ${project.fetchedPrs}` : ""}`}
              >
                {project.label} · open pull requests
              </Group>
              {prs.map((pr) => (
                <Row key={pr.id}>
                  <Pill tone={STATE_TONE[pr.state]}>{STATE_LABEL[pr.state]}</Pill>
                  <span className="grow">
                    <a href={pr.url} target="_blank" rel="noreferrer">
                      {pr.title}
                    </a>
                    <span className="sm">
                      #{pr.number} · {pr.initiative} · updated {age(pr.updatedAt)} ago
                      {pr.needsYouReason !== null && ` · ${pr.needsYouReason}`}
                    </span>
                  </span>
                </Row>
              ))}
            </Rows>
          ))}
        </>
      )}
    </>
  );
}
