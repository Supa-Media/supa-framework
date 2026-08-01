import { LABELS } from "../lib/labels";
import { selectQueue } from "../lib/select";
import { age } from "../lib/time";
import { Empty, Group, NotifyToggle, Pill, Row, Rows, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * ☰ Queue — what you approved, waiting to drain.
 *
 * The automerge pill comes from the `agent:automerge` label alone. Deriving it
 * instead from CODEOWNERS — "does this item's path require your review?" —
 * would mean fetching and parsing a CODEOWNERS file per repo and guessing which
 * paths an unwritten change will touch. The label is a decision something
 * already made, and reading a decision beats re-deriving it badly.
 */
export function Queue({ ctx }: { ctx: Ctx }) {
  const groups = selectQueue(ctx.snapshot.issues);
  const total = groups.reduce((sum, group) => sum + group.issues.length, 0);

  return (
    <>
      <ViewHeader
        title="Queue"
        sub={`${total} approved · drains overnight or on demand`}
      />

      {groups.length === 0 ? (
        <Empty>
          <b>The queue is empty.</b> Items arrive here when you approve an app&apos;s plan in the
          review — that adds <code>{LABELS.planApproved}</code> to its <code>{LABELS.ready}</code>{" "}
          issues.
        </Empty>
      ) : (
        groups.map((group) => (
          <Rows key={group.repoKey}>
            <Group right={`${group.issues.length} approved`}>{group.repoLabel}</Group>
            {group.issues.map((issue) => (
              <Row key={issue.id}>
                {issue.automerge ? (
                  <Pill tone="g">automerge</Pill>
                ) : (
                  <Pill tone="p">your merge</Pill>
                )}
                <span className="grow">
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    {issue.title}
                  </a>
                  <span className="sm">
                    #{issue.number}
                    {issue.initiatives.length > 0 && ` · ${issue.initiatives.join(", ")}`}
                    {issue.size !== null && ` · size ${issue.size}`} · approved{" "}
                    {age(issue.updatedAt)} ago
                  </span>
                </span>
                <NotifyToggle
                  on={issue.notify}
                  busy={ctx.actions.busy === `notify:${issue.id}`}
                  disabled={ctx.actions.busy !== null}
                  onToggle={() =>
                    ctx.actions.run(
                      `notify:${issue.id}`,
                      (writer) =>
                        issue.notify
                          ? writer.removeLabel(issue.repoSlug, issue.number, LABELS.notify)
                          : writer.addLabels(issue.repoSlug, issue.number, [LABELS.notify]),
                      issue.notify
                        ? `#${issue.number} is silent again — it batches to your next review.`
                        : `#${issue.number} will ping you at each milestone.`,
                    )
                  }
                />
              </Row>
            ))}
          </Rows>
        ))
      )}

      <p className="foot">
        ⚡ on an item means Telegram pings you at each milestone instead of waiting for the review.
        Silent is the default. An item without <code>{LABELS.automerge}</code> parks its PR for you
        to merge.
      </p>
    </>
  );
}
