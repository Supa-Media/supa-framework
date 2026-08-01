import { useState } from "react";

import { LABELS } from "../lib/labels";
import { questionOptions, deciderConfidence, type MarkerBlock } from "../lib/markers";
import { prodState } from "../lib/review";
import {
  selectDecisions,
  selectParked,
  selectPlan,
  selectQuestions,
} from "../lib/select";
import { absolute, age } from "../lib/time";
import type { Evidence } from "../lib/evidence";
import type { IssueCard } from "../sources/types";
import { Empty, Group, NotifyToggle, Pill, Row, Rows, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * ☀️ Review — the twice-a-day ritual, and the reason this app exists.
 *
 * Five bands, in the order a morning actually goes: what shipped, what was
 * decided for you, what is genuinely stuck, what you are approving for today,
 * what was asked and batched. Everything else in the app supports this screen;
 * nothing else is required to look at.
 *
 * Every control here writes a label or a comment. There is no state on this
 * page that GitHub does not already hold, except the "last reviewed" stamp.
 */
export function Review({
  ctx,
  onMarkReviewed,
}: {
  ctx: Ctx;
  onMarkReviewed: () => void;
}) {
  const { snapshot, config, actions, since } = ctx;
  const [collapsed, setCollapsed] = useState(false);

  const decisions = selectDecisions(snapshot.issues, since);
  const parked = selectParked(snapshot.issues);
  const questions = selectQuestions(snapshot.issues);
  const plan = selectPlan(snapshot.issues);

  const prodByRepo = new Map(
    snapshot.projects.map((project) => [project.key, project.lastProdDeploy?.at ?? null]),
  );

  const label = new Date().getHours() < 14 ? "Morning review" : "Evening review";
  const nothing =
    snapshot.shipped.length === 0 &&
    decisions.length === 0 &&
    parked.length === 0 &&
    questions.length === 0 &&
    plan.length === 0;

  return (
    <>
      <ViewHeader
        title={label}
        sub={`since ${absolute(since)} — decisions now, then it runs without you`}
        actions={
          <>
            <a className="bt" href={config.telegramUrl} target="_blank" rel="noreferrer">
              🎙 course-correct
            </a>
            <button
              type="button"
              className="bt pri"
              onClick={() => {
                onMarkReviewed();
                setCollapsed(true);
              }}
            >
              {collapsed ? "reviewed" : "mark reviewed"}
            </button>
          </>
        }
      />

      {collapsed && (
        <p className="lead">
          Reviewed. The window has moved to now — nothing below is waiting on you until the next
          one. <button type="button" className="bt quiet" onClick={() => setCollapsed(false)}>
            show anyway
          </button>
        </p>
      )}

      {!collapsed && nothing && (
        <Empty>
          <b>Nothing happened since your last review.</b> No merges, no decisions, no parks, and
          nothing queued for approval. That is a normal outcome of a quiet night, not a loading
          state — the fetch completed.
        </Empty>
      )}

      {!collapsed && (
        <>
          {snapshot.shipped.length > 0 && (
            <Rows>
              <Group tone="g" right={`${snapshot.shipped.length} merged`}>
                shipped since your last review
              </Group>
              {snapshot.shipped.map((pr) => (
                <Row key={pr.id}>
                  <span className="tick">✓</span>
                  <span className="grow">
                    <a href={pr.url} target="_blank" rel="noreferrer">
                      {pr.title}
                    </a>
                    <span className="sm">
                      {pr.repoLabel} #{pr.number} · merged {age(pr.mergedAt)} ago
                      {pr.author !== null && ` · ${pr.author}`}
                    </span>
                  </span>
                  <span className="proof">
                    <EvidenceChips evidence={pr.evidence} />
                    <DeployChips mergedAt={pr.mergedAt} prodAt={prodByRepo.get(pr.repoKey) ?? null} />
                  </span>
                </Row>
              ))}
            </Rows>
          )}

          {decisions.length > 0 && (
            <Rows>
              <Group tone="p" right="overturn anything">
                decisions made in your absence
              </Group>
              {decisions.map((decision) => {
                const key = `overturn:${decision.issue.id}:${decision.at}`;
                const confidence = deciderConfidence(decision.block);
                return (
                  <Row key={key}>
                    <Pill tone="p">decider</Pill>
                    <span className="grow">
                      <a href={decision.commentUrl} target="_blank" rel="noreferrer">
                        {decision.block.headline || decision.issue.title}
                      </a>
                      <span className="sm">
                        {decision.issue.repoLabel} #{decision.issue.number}
                        {decision.block.fields["reasoning"] !== undefined &&
                          ` · ${decision.block.fields["reasoning"]}`}
                        {confidence !== null && ` · confidence ${confidence}`}
                      </span>
                    </span>
                    <OverturnButton ctx={ctx} decision={decision.issue} block={decision.block} />
                    <a
                      className="bt pri"
                      href={decision.commentUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Keeping a decision is doing nothing — this just opens it."
                    >
                      Keep
                    </a>
                  </Row>
                );
              })}
              <Row>
                <span className="grow sm">
                  Keeping is the default: a decision you do not overturn stands, so “Keep” only
                  opens the comment. Overturning files a reply and relabels the issue{" "}
                  <code>{LABELS.ready}</code>.
                </span>
              </Row>
            </Rows>
          )}

          {parked.length > 0 && (
            <Rows>
              <Group tone="r" right="genuinely needs you">
                parked
              </Group>
              {parked.map(({ issue, sheet, sheetUrl }) => (
                <Row key={issue.id}>
                  <Pill tone="r">parked</Pill>
                  <span className="grow">
                    <a href={issue.url} target="_blank" rel="noreferrer">
                      {issue.title}
                    </a>
                    <span className="sm">
                      {issue.repoLabel} #{issue.number} · parked {age(issue.updatedAt)} ago
                    </span>
                    {sheet !== null ? (
                      <ContextSheet block={sheet} />
                    ) : (
                      <span className="sm">
                        No context sheet on this issue — the watchdog parked it without writing
                        one, so the history is only in the issue itself.
                      </span>
                    )}
                  </span>
                  {sheetUrl !== null && (
                    <a className="bt" href={sheetUrl} target="_blank" rel="noreferrer">
                      open sheet
                    </a>
                  )}
                  <UnparkButton ctx={ctx} issue={issue} />
                </Row>
              ))}
            </Rows>
          )}

          {plan.length > 0 && (
            <Rows>
              <Group right="approve and walk away">today&apos;s plan, per app</Group>
              {plan.map((repoGroup) => {
                const key = `approve:${repoGroup.repoKey}`;
                return (
                  <Row key={repoGroup.repoKey}>
                    <span className="grow">
                      <b>{repoGroup.repoLabel}</b> · {repoGroup.issues.length}{" "}
                      {repoGroup.issues.length === 1 ? "item" : "items"}
                      <span className="sm">
                        {repoGroup.issues.map((issue) => issue.title).join(" → ")}
                      </span>
                    </span>
                    <span className="bt-row">
                      {repoGroup.issues.map((issue) => (
                        <NotifyToggle
                          key={issue.id}
                          on={issue.notify}
                          busy={actions.busy === `notify:${issue.id}`}
                          onToggle={() =>
                            actions.run(`notify:${issue.id}`, (writer) =>
                              issue.notify
                                ? writer.removeLabel(issue.repoSlug, issue.number, LABELS.notify)
                                : writer.addLabels(issue.repoSlug, issue.number, [LABELS.notify]),
                            )
                          }
                        />
                      ))}
                    </span>
                    <button
                      type="button"
                      className="bt pri"
                      disabled={actions.busy !== null}
                      onClick={() =>
                        actions.run(key, (writer) =>
                          writer.addLabelToMany(
                            repoGroup.repoSlug,
                            repoGroup.issues.map((issue) => issue.nodeId),
                            LABELS.planApproved,
                          ),
                        )
                      }
                    >
                      {actions.busy === key ? "approving…" : `Approve ${repoGroup.repoLabel}`}
                    </button>
                  </Row>
                );
              })}
            </Rows>
          )}

          {questions.length > 0 && (
            <Rows>
              <Group right="nothing pinged you overnight">questions batched for you</Group>
              {questions.map((question) => (
                <QuestionRow key={question.issue.id} ctx={ctx} question={question} />
              ))}
            </Rows>
          )}

          <p className="foot">
            Between reviews only ⚡-flagged items and true blockers reach Telegram; everything else
            waits here. The next review is the same screen.
          </p>
        </>
      )}
    </>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function EvidenceChips({ evidence }: { evidence: Evidence }) {
  if (evidence.items.length === 0) {
    return (
      <span className="pf" title="This PR body had no `## Evidence` section.">
        no evidence
      </span>
    );
  }

  return (
    <>
      {evidence.screenshotCount > 0 && <span className="pf">📷 ×{evidence.screenshotCount}</span>}
      {evidence.items
        .filter((item) => item.kind !== "screenshot" || evidence.screenshotCount === 0)
        .slice(0, 3)
        .map((item, index) =>
          item.url === null ? (
            <span className="pf" key={index} title={item.label}>
              {item.label}
            </span>
          ) : (
            <a
              className="pf"
              key={index}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              title={item.label}
            >
              {item.label}
            </a>
          ),
        )}
    </>
  );
}

/**
 * Staging is not computed: every repo deploys staging on merge, so a merged PR
 * is on staging by definition. Production is a separate human-triggered
 * workflow, and that comparison is the only one worth a chip.
 */
function DeployChips({ mergedAt, prodAt }: { mergedAt: string; prodAt: string | null }) {
  const state = prodState(mergedAt, prodAt);
  return (
    <>
      <span className="pf g">staging ✓</span>
      {state === "in-production" && <span className="pf g">prod ✓</span>}
      {state === "awaiting-production" && <span className="pf y">awaiting prod</span>}
      {state === "unknown" && <span className="pf">prod ?</span>}
    </>
  );
}

function ContextSheet({ block }: { block: MarkerBlock }) {
  const entries = Object.entries(block.fields).filter(([key]) => key !== "options");
  if (entries.length === 0 && block.body === "") return null;

  return (
    <dl className="sheet">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}:</dt> <dd>{value}</dd>
        </div>
      ))}
      {block.body !== "" && <div>{block.body}</div>}
    </dl>
  );
}

function OverturnButton({
  ctx,
  decision,
  block,
}: {
  ctx: Ctx;
  decision: IssueCard;
  block: MarkerBlock;
}) {
  const key = `overturn:${decision.id}`;
  const busy = ctx.actions.busy === key;

  return (
    <button
      type="button"
      className="bt danger"
      disabled={ctx.actions.busy !== null}
      onClick={() => {
        // A reason is required, not optional. An overturn with no reason teaches
        // the decider nothing, and the whole point of logging decisions is that
        // the next one is better.
        const reason = window.prompt(
          `Overturn: ${block.headline || decision.title}\n\nWhy? (this is posted as a comment and the item goes back to ${LABELS.ready})`,
        );
        if (reason === null || reason.trim() === "") return;

        ctx.actions.run(key, async (writer) => {
          await writer.comment(
            decision.repoSlug,
            decision.number,
            `@overturn: ${reason.trim()}\n\nOverturned at review. The decision above does not stand; re-decide with this constraint.`,
          );
          await writer.addLabels(decision.repoSlug, decision.number, [LABELS.ready]);
        });
      }}
    >
      {busy ? "…" : "Overturn"}
    </button>
  );
}

function UnparkButton({ ctx, issue }: { ctx: Ctx; issue: IssueCard }) {
  const key = `unpark:${issue.id}`;
  const busy = ctx.actions.busy === key;

  return (
    <button
      type="button"
      className="bt pri"
      disabled={ctx.actions.busy !== null}
      onClick={() => {
        const note = window.prompt(
          `Unpark: ${issue.title}\n\nWhat changed? (posted as a comment, then the item goes back to ${LABELS.ready})`,
        );
        if (note === null || note.trim() === "") return;

        ctx.actions.run(key, async (writer) => {
          await writer.comment(issue.repoSlug, issue.number, note.trim());
          await writer.addLabels(issue.repoSlug, issue.number, [LABELS.ready]);
          await writer.removeLabel(issue.repoSlug, issue.number, LABELS.blocked);
        });
      }}
    >
      {busy ? "…" : "I fixed it"}
    </button>
  );
}

function QuestionRow({
  ctx,
  question,
}: {
  ctx: Ctx;
  question: { issue: IssueCard; block: MarkerBlock; commentUrl: string; at: string };
}) {
  const { issue, block } = question;
  const options = questionOptions(block);
  const key = `answer:${issue.id}`;
  const busy = ctx.actions.busy === key;

  const answer = (text: string) =>
    ctx.actions.run(key, async (writer) => {
      await writer.comment(issue.repoSlug, issue.number, `**[answer]** ${text}`);
      await writer.addLabels(issue.repoSlug, issue.number, [LABELS.ready]);
      await writer.removeLabel(issue.repoSlug, issue.number, LABELS.blocked);
    });

  return (
    <Row>
      <Pill>q</Pill>
      <span className="grow">
        <a href={question.commentUrl} target="_blank" rel="noreferrer">
          {block.headline || issue.title}
        </a>
        <span className="sm">
          {issue.repoLabel} #{issue.number} · held {age(question.at)} — not ⚡-flagged, so it waited
          for this review
        </span>
      </span>
      <span className="bt-row">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="bt"
            disabled={ctx.actions.busy !== null}
            onClick={() => answer(option)}
          >
            {busy ? "…" : option}
          </button>
        ))}
        <button
          type="button"
          className="bt quiet"
          disabled={ctx.actions.busy !== null}
          onClick={() => {
            const free = window.prompt(`Answer: ${block.headline || issue.title}`);
            if (free === null || free.trim() === "") return;
            answer(free.trim());
          }}
        >
          {options.length === 0 ? "Answer" : "other…"}
        </button>
      </span>
    </Row>
  );
}
