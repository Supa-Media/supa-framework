import { useState } from "react";

import { indexInitiatives, type InitiativeEntry } from "../lib/initiativesFile";
import { selectByInitiative } from "../lib/select";
import { absolute, age } from "../lib/time";
import type { ProjectSnapshot } from "../sources/types";
import {
  Empty,
  Group,
  Pill,
  Row,
  Rows,
  RunDot,
  ViewHeader,
  type Tone,
} from "../components/ui";
import type { Ctx } from "./context";

const PHASE_TONE: Record<string, Tone> = {
  idea: "n",
  building: "y",
  launched: "g",
  hardening: "y",
  quiet: "n",
  done: "g",
};

/**
 * One app — its initiatives, its environments, its archive.
 *
 * An initiative is discovered two ways and neither is authoritative alone:
 *
 *   - `init:*` labels on open issues, and branch prefixes on open PRs. This is
 *     the v2 heuristic. It always finds the work, and never knows what phase it
 *     is in.
 *   - `.fleet/initiatives.json`, when the repo has one. This is the only source
 *     of phase and of "archived", because both are statements a human makes.
 *
 * The two are merged, not ranked: an initiative in the manifest but with no
 * open work still shows (it may be in `quiet`), and an initiative with work but
 * no manifest entry shows with no phase chip rather than a guessed one.
 */
export function AppView({ ctx, project }: { ctx: Ctx; project: ProjectSnapshot }) {
  const [showArchived, setShowArchived] = useState(false);

  const manifest = indexInitiatives(project.manifest);
  const byLabel = selectByInitiative(ctx.snapshot.issues, project.key);
  const byBranch = new Map(
    project.initiatives.map((initiative) => [initiative.name, initiative.prs]),
  );

  const names = new Set<string>([...manifest.keys(), ...byLabel.keys(), ...byBranch.keys()]);
  const cards = [...names]
    .map((name) => ({
      name,
      entry: manifest.get(name) ?? null,
      issues: byLabel.get(name) ?? [],
      prs: byBranch.get(name) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const live = cards.filter((card) => card.entry?.archived !== true);
  const archived = cards.filter((card) => card.entry?.archived === true);

  const manifestUrl = `https://github.com/${project.slug}/edit/${encodeURIComponent(
    project.defaultBranch,
  )}/${ctx.config.initiativesPath}`;
  const newManifestUrl = `https://github.com/${project.slug}/new/${encodeURIComponent(
    project.defaultBranch,
  )}?filename=${encodeURIComponent(ctx.config.initiativesPath)}&value=${encodeURIComponent(
    JSON.stringify({ initiatives: [{ name: "example", phase: "building", archived: false }] }, null, 2),
  )}`;
  const hasManifest = project.manifest.entries.length > 0;

  return (
    <>
      <ViewHeader
        title={project.label}
        sub={`${project.openPrs} open PRs · ${project.activeRuns} runs in flight`}
        actions={
          <>
            <a className="bt" href={project.url} target="_blank" rel="noreferrer">
              repo
            </a>
            <a
              className="bt pri"
              href={hasManifest ? manifestUrl : newManifestUrl}
              target="_blank"
              rel="noreferrer"
              title={`Edit ${ctx.config.initiativesPath} on GitHub`}
            >
              ＋ initiative
            </a>
          </>
        }
      />

      {project.manifest.problems.length > 0 && (
        <p className="banner err">
          <code>{ctx.config.initiativesPath}</code> has problems:
          <ul>
            {project.manifest.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </p>
      )}

      {live.length === 0 ? (
        <Empty>
          <b>No initiatives found.</b> They are discovered from <code>init:*</code> labels on open
          issues and from branch prefixes on open PRs — neither of which this repo has right now.
          Adding <code>{ctx.config.initiativesPath}</code> lets you name them (and give each a
          phase) before the work starts.
        </Empty>
      ) : (
        <div className="cards">
          {live.map((card) => (
            <InitiativeCard
              key={card.name}
              name={card.name}
              entry={card.entry}
              issueCount={card.issues.length}
              prCount={card.prs.length}
              slug={project.slug}
              branch={project.defaultBranch}
              manifestPath={ctx.config.initiativesPath}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <Rows>
          <Group
            right={
              <button
                type="button"
                className="bt quiet"
                onClick={() => setShowArchived((value) => !value)}
              >
                {showArchived ? "hide" : `show ${archived.length}`}
              </button>
            }
          >
            archived — data kept
          </Group>
          {showArchived &&
            archived.map((card) => (
              <Row key={card.name}>
                <span className="grow">
                  {card.name}
                  <span className="sm">
                    {card.issues.length} open issues · {card.prs.length} open PRs
                    {card.entry?.spec !== null && card.entry?.spec !== undefined && (
                      <>
                        {" · "}
                        <a
                          href={`https://github.com/${project.slug}/blob/${project.defaultBranch}/${card.entry.spec}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          spec
                        </a>
                      </>
                    )}
                  </span>
                </span>
                <a className="bt" href={manifestUrl} target="_blank" rel="noreferrer">
                  unarchive
                </a>
              </Row>
            ))}
        </Rows>
      )}

      <Rows>
        <Group right={hasManifest ? undefined : "no manifest"}>environments</Group>
        <Row>
          <span className="grow">
            <b>staging</b>
            <span className="sm">automatic on merge to {project.defaultBranch}</span>
          </span>
          <RunDot run={project.ci} fallback="no CI runs" />
        </Row>
        <Row>
          <span className="grow">
            <b>production</b>
            <span className="sm">
              {project.lastProdDeploy === null
                ? "no successful production run visible to this token"
                : `${project.lastProdDeploy.name} · ${absolute(project.lastProdDeploy.at)}`}
            </span>
          </span>
          <RunDot run={project.lastProdDeploy} fallback="never" />
        </Row>
        <Row>
          <span className="grow">
            <b>last deploy of any kind</b>
            <span className="sm">
              {project.lastDeploy === null ? "—" : project.lastDeploy.name}
            </span>
          </span>
          <RunDot run={project.lastDeploy} fallback="never" />
        </Row>
      </Rows>
    </>
  );
}

function InitiativeCard({
  name,
  entry,
  issueCount,
  prCount,
  slug,
  branch,
  manifestPath,
}: {
  name: string;
  entry: InitiativeEntry | null;
  issueCount: number;
  prCount: number;
  slug: string;
  branch: string;
  manifestPath: string;
}) {
  const specUrl =
    entry?.spec == null ? null : `https://github.com/${slug}/blob/${branch}/${entry.spec}`;

  return (
    <div className="card">
      <span className="card__chip" aria-hidden="true">
        ◈
      </span>
      <span className="card__title">
        {name}
        {entry?.phase != null && <Pill tone={PHASE_TONE[entry.phase] ?? "n"}>{entry.phase}</Pill>}
      </span>
      <span className="card__body">
        {issueCount === 0 && prCount === 0
          ? "no open work"
          : `${issueCount} open ${issueCount === 1 ? "issue" : "issues"} · ${prCount} open ${prCount === 1 ? "PR" : "PRs"}`}
        {entry === null && (
          <>
            <br />
            <span className="muted">
              inferred from labels and branches — no manifest entry, so no phase
            </span>
          </>
        )}
      </span>
      <span className="card__stat">
        {specUrl !== null && (
          <a href={specUrl} target="_blank" rel="noreferrer">
            spec
          </a>
        )}
        <a
          href={`https://github.com/${slug}/edit/${encodeURIComponent(branch)}/${manifestPath}`}
          target="_blank"
          rel="noreferrer"
          title="Archive or re-phase this initiative by editing the manifest"
        >
          {entry === null ? "add to manifest" : "archive / edit"}
        </a>
      </span>
    </div>
  );
}

/** The Apps landing view: one card per repo. */
export function AppsIndex({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <ViewHeader title="Apps" sub="one card per repo in the fleet" />
      <div className="cards">
        {ctx.snapshot.projects.map((project) => (
          <button
            key={project.key}
            type="button"
            className="card"
            onClick={() => ctx.navigate(`app:${project.key}`)}
          >
            <span className="card__chip" aria-hidden="true">
              ▣
            </span>
            <span className="card__title">{project.label}</span>
            <span className="card__body">
              {project.lastProdDeploy === null
                ? "no production deploy seen"
                : `prod ${age(project.lastProdDeploy.at)} ago`}
            </span>
            <span className="card__stat">
              <span>
                <b>{project.openPrs}</b> open PRs
              </span>
              <span>
                <b>{project.activeRuns}</b> running
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
