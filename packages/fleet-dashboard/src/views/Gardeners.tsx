import { useState } from "react";

import { formatUsd } from "../lib/cost";
import { formatEngine } from "../lib/engine";
import { absolute, until } from "../lib/time";
import type { Gardener } from "../sources/types";
import { Empty, RunDot, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * 🌱 Gardeners — the weekly maintenance workflows, with their prompts visible.
 *
 * Two things are new against v1: the caps column (`max-ai-credits` and
 * `max-daily-ai-credits` from the source frontmatter, converted from gh-aw's AI
 * Credits to dollars) and the prompt, expandable inline and **read-only**.
 *
 * Read-only is deliberate. Editing a gardener means editing its markdown, which
 * gh-aw then compiles into the `.lock.yml` that Actions actually runs — so a
 * write from here that skipped compilation would produce a file whose prompt
 * and whose behaviour disagree. Every edit affordance is a deep link into
 * GitHub's own editor, where the change becomes a normal commit and the compile
 * step runs.
 */
export function Gardeners({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState<string | null>(null);
  const gardeners: Gardener[] = ctx.snapshot.projects.flatMap((project) => project.gardeners);

  const total = gardeners
    .map((gardener) => gardener.costReportedUsd)
    .filter((cost): cost is number => cost !== null)
    .reduce((sum, cost) => sum + cost, 0);

  return (
    <>
      <ViewHeader
        title="Gardeners"
        sub={
          gardeners.length === 0
            ? "none found"
            : `${gardeners.length} across the fleet · ${formatUsd(total === 0 ? null : total)} last report`
        }
      />

      {gardeners.length === 0 ? (
        <Empty>
          No <code>gardener-*.lock.yml</code> workflows found. Add a gh-aw maintenance workflow and
          it appears here automatically — nothing to configure.
        </Empty>
      ) : (
        <div className="tablewrap">
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">gardener</th>
                <th scope="col">engine · model</th>
                <th scope="col">last</th>
                <th scope="col" className="num">
                  cost
                </th>
                <th scope="col">caps</th>
                <th scope="col">cadence</th>
                <th scope="col">prompt</th>
              </tr>
            </thead>
            <tbody>
              {gardeners.map((gardener) => {
                const key = `${gardener.repoKey}:${gardener.workflowPath}`;
                const isOpen = open === key;
                return [
                  <tr key={key}>
                    <td>
                      <b>{gardener.name}</b>
                      <span className="rowsub">{gardener.repoLabel}</span>
                    </td>
                    <td className="mono nowrap">{formatEngine(gardener.engine)}</td>
                    <td>
                      <RunDot run={gardener.lastRun} fallback="never" />
                    </td>
                    <td className="num">{formatUsd(gardener.costReportedUsd)}</td>
                    <td className="mono nowrap">
                      <Caps gardener={gardener} />
                    </td>
                    <td>
                      <span className="nowrap">{gardener.schedule}</span>
                      {gardener.nextRunAt !== null && (
                        <span className="rowsub" title={absolute(gardener.nextRunAt)}>
                          next {until(gardener.nextRunAt)}
                        </span>
                      )}
                      <a
                        className="edit"
                        href={gardener.editUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Edit cadence for ${gardener.name}`}
                        title={`Edit ${gardener.sourcePath} on GitHub`}
                      >
                        ✎
                      </a>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="bt quiet"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : key)}
                      >
                        {isOpen ? "hide ▴" : "view ▾"}
                      </button>
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${key}:prompt`}>
                      <td colSpan={7}>
                        <pre className="promptbox">
                          {gardener.prompt === ""
                            ? `No markdown body in ${gardener.sourcePath} — either the source could not be read with this token, or the file is frontmatter only.`
                            : gardener.prompt}
                        </pre>
                        <span className="rowsub">
                          Read-only here. Editing opens{" "}
                          <code>{gardener.sourcePath}</code> in GitHub&apos;s editor, so the change
                          goes through the normal commit and gh-aw recompile.{" "}
                          <a
                            className="edit"
                            href={gardener.editUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            edit ✎
                          </a>
                        </span>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="foot">
        Caps come from the source&apos;s <code>max-ai-credits</code> and{" "}
        <code>max-daily-ai-credits</code>; gh-aw meters in AI Credits at 1 credit = $0.01, so they
        are shown in dollars. Cost is what the most recent weekly report said — <code>—</code> means
        unknown, never $0.00.
      </p>
    </>
  );
}

function Caps({ gardener }: { gardener: Gardener }) {
  const { perRunUsd, perDayUsd, maxTurns } = gardener.caps;
  if (perRunUsd === null && perDayUsd === null && maxTurns === null) {
    return (
      <a className="edit" href={gardener.editUrl} target="_blank" rel="noreferrer" title="Declare caps">
        none ✎
      </a>
    );
  }
  return (
    <>
      {formatUsd(perRunUsd)} / {formatUsd(perDayUsd)}
      <a className="edit" href={gardener.editUrl} target="_blank" rel="noreferrer" title="Edit caps">
        ✎
      </a>
      {maxTurns !== null && <span className="rowsub">{maxTurns} turns</span>}
    </>
  );
}
