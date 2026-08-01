import { LABELS } from "../lib/labels";
import { findMarker } from "../lib/markers";
import { MARKER_CONTEXT_SHEET, selectParked, selectWatchdogReports } from "../lib/select";
import { age } from "../lib/time";
import { Empty, Group, Pill, Row, Rows, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * 🐕 Watchdog — the ladder as policy, the reports as evidence.
 *
 * The ladder and the policy line are static content from `fleet.config.ts`,
 * because they are a decision about how the fleet runs, not data the API can
 * observe. The interventions log below them is the opposite: it is entirely
 * the `watchdog:report` issues, so nothing on this page claims an intervention
 * happened unless an issue says so.
 */
export function Watchdog({ ctx }: { ctx: Ctx }) {
  const reports = selectWatchdogReports(ctx.snapshot.issues);
  const parked = selectParked(ctx.snapshot.issues);

  return (
    <>
      <ViewHeader
        title="Watchdog"
        sub="fixes first, reports last — you hear about it at review"
      />

      <Rows>
        <Group>the ladder</Group>
        {ctx.config.watchdogLadder.map((rung) => (
          <Row key={rung.rung}>
            <Pill tone={rung.tone}>{rung.rung}</Pill>
            <span className="grow">
              <b>{rung.title}</b>
              <span className="sm">{rung.body}</span>
            </span>
          </Row>
        ))}
      </Rows>

      <Rows>
        <Group right={`${reports.length} logged`}>interventions</Group>
        {reports.length === 0 ? (
          <Row>
            <span className="grow sm">
              No open issue carries <code>{LABELS.watchdogReport}</code>. Either the watchdog has
              had a quiet run, or it is not filing reports yet — this list is only ever what the
              issues say.
            </span>
          </Row>
        ) : (
          reports.map((issue) => {
            const sheet = findMarker(issue.body, MARKER_CONTEXT_SHEET);
            return (
              <Row key={issue.id}>
                <Pill tone="y">report</Pill>
                <span className="grow">
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    {issue.title}
                  </a>
                  <span className="sm">
                    {issue.repoLabel} #{issue.number} · {age(issue.updatedAt)} ago
                    {sheet !== null && " · context sheet attached"}
                  </span>
                </span>
              </Row>
            );
          })
        )}
      </Rows>

      {parked.length > 0 && (
        <Rows>
          <Group tone="r" right="rung 4">
            currently parked
          </Group>
          {parked.map(({ issue }) => (
            <Row key={issue.id}>
              <span className="grow">
                <a href={issue.url} target="_blank" rel="noreferrer">
                  {issue.title}
                </a>
                <span className="sm">
                  {issue.repoLabel} #{issue.number} · handled in your review, not here
                </span>
              </span>
            </Row>
          ))}
        </Rows>
      )}

      <Rows>
        <Group>policy</Group>
        <Row>
          <span className="grow sm">{ctx.config.watchdogPolicy}</span>
        </Row>
      </Rows>

      {reports.length === 0 && parked.length === 0 && (
        <Empty>
          Nothing to intervene in. This page is static policy plus whatever the{" "}
          <code>{LABELS.watchdogReport}</code> and <code>{LABELS.blocked}</code> labels say; it has
          no other source.
        </Empty>
      )}
    </>
  );
}
