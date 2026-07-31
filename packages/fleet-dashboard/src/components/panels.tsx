import type { ReactNode } from "react";

import { formatUsd } from "../lib/cost";
import { formatEngine } from "../lib/engine";
import { absolute, age, until } from "../lib/time";
import type {
  FleetSnapshot,
  Gardener,
  ProjectSnapshot,
  PrState,
  PullRequestCard,
  RunSummary,
} from "../sources/types";

/**
 * Every read-only panel of the dashboard, in wireframe order:
 * project cards → ACTIVE WORK → GARDENERS → NEEDS YOU.
 *
 * They live in one file because they are one screen: each is 30–60 lines, they
 * share the same four presentational helpers below, and splitting them into
 * six files would mean six imports to trace to understand one page.
 */

const STATE_LABEL: Record<PrState, string> = {
  draft: "draft",
  "ci-running": "CI running",
  "ci-failed": "CI failed",
  conflict: "conflict",
  review: "review",
  mergeable: "mergeable",
};

function StateChip({ state }: { state: PrState }) {
  return <span className={`chip chip--${state}`}>{STATE_LABEL[state]}</span>;
}

function RunDot({ run, fallback }: { run: RunSummary | null; fallback: string }) {
  if (!run) return <span className="muted">{fallback}</span>;
  return (
    <a
      className={`run run--${run.state}`}
      href={run.url}
      target="_blank"
      rel="noreferrer"
      title={`${run.name} — ${absolute(run.at)}`}
    >
      <span className="run__dot" aria-hidden="true" />
      <span className="run__age">{age(run.at)}</span>
    </a>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <h2 className="section__title">
        {title}
        {count !== undefined && <span className="section__count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Tooltip explaining a count the list below it doesn't fully show. */
function prCountTitle(project: ProjectSnapshot): string | undefined {
  if (project.fetchedPrs >= project.openPrs) return undefined;
  return `${project.openPrs} open; ${project.fetchedPrs} fetched (pagination cap)`;
}

function reportAge(iso: string | null): string {
  return iso === null ? "no cost report found" : `report updated ${absolute(iso)}`;
}

/* ── Header ─────────────────────────────────────────────────────────────── */

export function Header({
  name,
  snapshot,
  loading,
  onRefresh,
  onForgetToken,
}: {
  name: string;
  snapshot: FleetSnapshot;
  loading: boolean;
  onRefresh: () => void;
  onForgetToken: () => void;
}) {
  const fetched = snapshot.projects.length > 0 ? absolute(snapshot.fetchedAt) : "never";

  return (
    <header className="header">
      <div className="header__top">
        <h1>{name}</h1>
        <div className="header__actions">
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="link-button" onClick={onForgetToken}>
            Sign out
          </button>
        </div>
      </div>
      <dl className="header__stats">
        <div>
          {/* Not "MTD": the gh-aw report is weekly and nothing here does month
              arithmetic, so the label states what the number actually is. */}
          <dt>Spend (last report)</dt>
          <dd className="num" title={reportAge(snapshot.spendReportedAt)}>
            {formatUsd(snapshot.spendReportedUsd)}
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{loading ? "…" : fetched}</dd>
        </div>
        {snapshot.rateLimit && (
          <div>
            <dt>API budget</dt>
            <dd className="num">
              {snapshot.rateLimit.remaining}/{snapshot.rateLimit.limit}
            </dd>
          </div>
        )}
      </dl>
      {snapshot.errors.length > 0 && (
        <ul className="errors">
          {snapshot.errors.map((error, index) => (
            <li key={`${error.scope}-${index}`}>
              <strong>{error.scope}</strong> {error.message}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

/* ── Project cards ──────────────────────────────────────────────────────── */

export function ProjectCards({ projects }: { projects: ProjectSnapshot[] }) {
  return (
    <div className="cards">
      {projects.map((project) => (
        <article className="card" key={project.key}>
          <a className="card__title" href={project.url} target="_blank" rel="noreferrer">
            {project.label}
          </a>
          <dl className="card__grid">
            <div>
              <dt>Active runs</dt>
              <dd className="num">{project.activeRuns}</dd>
            </div>
            <div>
              <dt>Open PRs</dt>
              <dd className="num" title={prCountTitle(project)}>
                {project.openPrs}
                {project.fetchedPrs < project.openPrs && <span className="partial">+</span>}
              </dd>
            </div>
            <div>
              <dt>CI ({project.defaultBranch})</dt>
              <dd>
                <RunDot run={project.ci} fallback="no runs" />
              </dd>
            </div>
            <div>
              <dt>Last deploy</dt>
              <dd>
                <RunDot run={project.lastDeploy} fallback="never" />
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

/* ── Active work ────────────────────────────────────────────────────────── */

function PrRow({ pr }: { pr: PullRequestCard }) {
  return (
    <li className="pr">
      <a className="pr__link" href={pr.url} target="_blank" rel="noreferrer">
        <span className="pr__number">#{pr.number}</span>
        <span className="pr__title">{pr.title}</span>
      </a>
      <div className="pr__meta">
        <StateChip state={pr.state} />
        <span className="pr__age" title={`opened ${absolute(pr.createdAt)}`}>
          {age(pr.createdAt)}
        </span>
      </div>
    </li>
  );
}

export function ActiveWork({ projects }: { projects: ProjectSnapshot[] }) {
  const total = projects.reduce((sum, project) => sum + project.openPrs, 0);
  const withWork = projects.filter((project) => project.initiatives.length > 0);

  return (
    <Section title="Active work" count={total}>
      {withWork.length === 0 ? (
        <Empty>No open pull requests across the fleet.</Empty>
      ) : (
        withWork.map((project) => (
          <div className="project-group" key={project.key}>
            <h3 className="project-group__name">{project.label}</h3>
            {project.fetchedPrs < project.openPrs && (
              // Say it out loud rather than render a short list as complete.
              <p className="truncated">
                showing {project.fetchedPrs} of {project.openPrs} open PRs
              </p>
            )}
            {project.initiatives.map((initiative) => (
              <div className="initiative" key={initiative.name}>
                <h4 className="initiative__name">
                  {initiative.name}
                  <span className="initiative__count">{initiative.prs.length}</span>
                </h4>
                <ul className="pr-list">
                  {initiative.prs.map((pr) => (
                    <PrRow pr={pr} key={pr.id} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))
      )}
    </Section>
  );
}

/* ── Gardeners ──────────────────────────────────────────────────────────── */

export function Gardeners({ projects }: { projects: ProjectSnapshot[] }) {
  const gardeners: Gardener[] = projects.flatMap((project) => project.gardeners);

  return (
    <Section title="Gardeners" count={gardeners.length}>
      {gardeners.length === 0 ? (
        <Empty>
          No <code>gardener-*.lock.yml</code> workflows found in the fleet yet. Add a gh-aw
          maintenance workflow and it appears here automatically.
        </Empty>
      ) : (
        <div className="table-scroll">
          <table className="gardeners">
            <thead>
              <tr>
                <th scope="col">Workflow</th>
                <th scope="col">Engine / model</th>
                <th scope="col">Last run</th>
                <th scope="col">Schedule</th>
                <th scope="col" className="num">
                  Cost (last report)
                </th>
                <th scope="col">
                  <span className="sr-only">Edit cadence</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {gardeners.map((gardener) => (
                <tr key={`${gardener.repoKey}:${gardener.workflowPath}`}>
                  <th scope="row">
                    <span className="gardener__name">{gardener.name}</span>
                    <span className="gardener__repo">{gardener.repoLabel}</span>
                  </th>
                  <td>
                    <span className="gardener__engine">{formatEngine(gardener.engine)}</span>
                  </td>
                  <td>
                    <RunDot run={gardener.lastRun} fallback="never" />
                  </td>
                  <td>
                    <span className="gardener__schedule">{gardener.schedule}</span>
                    {gardener.nextRunAt && (
                      <span className="gardener__next" title={absolute(gardener.nextRunAt)}>
                        next {until(gardener.nextRunAt)}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatUsd(gardener.costReportedUsd)}</td>
                  <td>
                    {/* The single write action in v1: GitHub's own web editor,
                        deep-linked to the gh-aw markdown source. */}
                    <a
                      className="edit"
                      href={gardener.editUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={`Edit ${gardener.sourcePath} on GitHub`}
                      aria-label={`Edit cadence for ${gardener.name}`}
                    >
                      ✎
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ── Needs you ──────────────────────────────────────────────────────────── */

export function NeedsYou({ prs }: { prs: PullRequestCard[] }) {
  return (
    <Section title="Needs you" count={prs.length}>
      {prs.length === 0 ? (
        <Empty>Nothing is blocked on you.</Empty>
      ) : (
        <ul className="pr-list pr-list--needs-you">
          {prs.map((pr) => (
            <li className="pr" key={pr.id}>
              <a className="pr__link" href={pr.url} target="_blank" rel="noreferrer">
                <span className="pr__number">#{pr.number}</span>
                <span className="pr__title">{pr.title}</span>
              </a>
              <div className="pr__meta">
                <span className="pr__repo">{pr.repoLabel}</span>
                <span className="chip chip--needs-you">{pr.needsYouReason}</span>
                <span className="pr__age" title={`updated ${absolute(pr.updatedAt)}`}>
                  {age(pr.updatedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
