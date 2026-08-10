import { useState } from "react";

import { INIT_PREFIX, LABELS } from "../lib/labels";
import { selectAppInitiatives, selectTriage, type InitiativeCardModel } from "../lib/select";
import { absolute, age } from "../lib/time";
import type { IssueCard, ProjectSnapshot } from "../sources/types";
import {
  Banner,
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
 * One app — its initiatives, its triage, its environments, its archive.
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
 *
 * What a branch prefix may *not* do is mint a card on its own if it is a
 * conventional-commit or harness prefix — `feat`, `chore`, `claude`, `cursor`.
 * Those are one quiet misc row. See `isNoisyInitiative`.
 */
export function AppView({ ctx, project }: { ctx: Ctx; project: ProjectSnapshot }) {
  const [showArchived, setShowArchived] = useState(false);

  if (project.tokenMissing) return <NoToken ctx={ctx} project={project} />;

  const { live, archived, misc } = selectAppInitiatives(ctx.snapshot.issues, project);

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
        // `searchFailed` means GitHub answered this repo's alias with null, so
        // `openPrs` is a fallback rather than an observation — see the
        // Partial-data banner above for which token could not see it.
        sub={`${project.searchFailed ? "open PRs unknown" : `${project.openPrs} open PRs`} · ${project.activeRuns} runs in flight`}
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
        <Banner tone="err">
          <code>{ctx.config.initiativesPath}</code> has problems:
          <ul>
            {project.manifest.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Banner>
      )}

      {live.length === 0 ? (
        // One line, and the affordance that fixes it. The old copy explained the
        // whole discovery heuristic here, which was three sentences of theory in
        // the exact spot where the answer is "there aren't any yet".
        <Empty>
          <b>No initiatives yet.</b>{" "}
          <a
            className="bt pri"
            href={hasManifest ? manifestUrl : newManifestUrl}
            target="_blank"
            rel="noreferrer"
          >
            ＋ initiative
          </a>
        </Empty>
      ) : (
        <div className="cards">
          {live.map((card) => (
            <InitiativeCard
              key={card.name}
              card={card}
              slug={project.slug}
              branch={project.defaultBranch}
              manifestPath={ctx.config.initiativesPath}
            />
          ))}
        </div>
      )}

      {misc.prefixes.length > 0 && (
        <Rows>
          <Group right={`${misc.prs.length} open ${misc.prs.length === 1 ? "PR" : "PRs"}`}>
            misc
          </Group>
          <Row>
            <span className="grow">
              {misc.prefixes.join(" · ")}
              <span className="sm">
                Conventional-commit and agent-harness branch prefixes. They group work, they do not
                name it — so they get one row rather than a card each.
              </span>
            </span>
          </Row>
        </Rows>
      )}

      <TriageSection ctx={ctx} project={project} initiatives={live} />

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

/**
 * The whole view for a repo whose owner has no token loaded.
 *
 * Not an error and not an empty state: nothing was fetched, so there is nothing
 * to be empty about. Rendering the normal view with zeros would claim the repo
 * has no initiatives, no CI, and no deploys — four confident statements about a
 * repo nobody looked at.
 */
function NoToken({ ctx, project }: { ctx: Ctx; project: ProjectSnapshot }) {
  return (
    <>
      <ViewHeader
        title={project.label}
        sub={`owned by ${project.owner}`}
        actions={
          <a className="bt" href={project.url} target="_blank" rel="noreferrer">
            repo
          </a>
        }
      />
      <Empty>
        <b>No token for {project.owner}.</b> A fine-grained PAT is scoped to a single resource
        owner, so this repo needs its own — nothing here was fetched. The rest of the fleet is
        loaded and accurate.{" "}
        <button type="button" className="bt pri" onClick={ctx.openTokens}>
          add a token
        </button>
      </Empty>
    </>
  );
}

function InitiativeCard({
  card,
  slug,
  branch,
  manifestPath,
}: {
  card: InitiativeCardModel;
  slug: string;
  branch: string;
  manifestPath: string;
}) {
  const { name, entry, inferred } = card;
  const issueCount = card.issues.length;
  const prCount = card.prs.length;
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
        {/*
          Only for a name nobody wrote down. An `init:` label with no manifest
          entry is already a human's word for it — the old copy called that
          "inferred" too, and said so on every card in the fleet.
        */}
        {inferred && (
          <>
            <br />
            <span className="muted">inferred — add to manifest</span>
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

/* ── Triage ─────────────────────────────────────────────────────────────── */

/** What a row did, kept just long enough that the row can undo it. */
interface Acted {
  issue: IssueCard;
  /** Every label the click added, so undo removes exactly those. */
  added: string[];
  verb: string;
}

/**
 * Triage — open issues the fleet is not managing.
 *
 * These are the bugs somebody filed and nothing ever picked up: no `agent:*`, no
 * `plan:approved`, no `inbox:*`, no `init:*`. They were invisible to every other
 * screen in this app, because every other screen selects **by** those labels.
 *
 * Two buttons, one label write each, and both undoable from the row. No confirm
 * step: the palette's two-step is for *filing an issue* (a new object, with a
 * typo'd title, that someone then has to close), while a label is the one write
 * this app can take straight back — which is what the undo row does.
 */
function TriageSection({
  ctx,
  project,
  initiatives,
}: {
  ctx: Ctx;
  project: ProjectSnapshot;
  initiatives: InitiativeCardModel[];
}) {
  const [acted, setActed] = useState<Acted[]>([]);
  const [showAutomation, setShowAutomation] = useState(false);

  const triage = selectTriage(ctx.snapshot.issues, project.key);
  const handled = new Set(acted.map((row) => row.issue.id));
  const work = triage.work.filter((issue) => !handled.has(issue.id));
  const automation = triage.automation.filter((issue) => !handled.has(issue.id));

  if (work.length === 0 && automation.length === 0 && acted.length === 0) return null;

  const remember = (row: Acted) => setActed((rows) => [...rows, row]);
  const forget = (id: string) => setActed((rows) => rows.filter((row) => row.issue.id !== id));

  return (
    <Rows>
      <Group right={work.length === 0 ? "clear" : `${work.length} untriaged`}>
        triage — filed, but nothing is managing it
      </Group>

      {work.map((issue) => (
        <TriageRow
          key={issue.id}
          ctx={ctx}
          issue={issue}
          initiatives={initiatives}
          onActed={remember}
        />
      ))}

      {acted.map((row) => (
        <UndoRow key={`undo:${row.issue.id}`} ctx={ctx} row={row} onUndone={forget} />
      ))}

      {automation.length > 0 && (
        <>
          <Group
            right={
              <button
                type="button"
                className="bt quiet"
                onClick={() => setShowAutomation((value) => !value)}
              >
                {showAutomation ? "hide" : `show ${automation.length}`}
              </button>
            }
          >
            automation reports — operational, not product work
          </Group>
          {showAutomation &&
            automation.map((issue) => (
              <TriageRow
                key={issue.id}
                ctx={ctx}
                issue={issue}
                initiatives={initiatives}
                onActed={remember}
              />
            ))}
        </>
      )}
    </Rows>
  );
}

function TriageRow({
  ctx,
  issue,
  initiatives,
  onActed,
}: {
  ctx: Ctx;
  issue: IssueCard;
  initiatives: InitiativeCardModel[];
  onActed: (row: Acted) => void;
}) {
  const [initiative, setInitiative] = useState("");
  const queueKey = `queue:${issue.id}`;
  const laterKey = `later:${issue.id}`;
  const busy = ctx.actions.busy;

  // The `init:` label is added in the same call as `agent:ready`, so the
  // known-labels guard checks both before either lands: an initiative named only
  // in the manifest has no label yet, and the write is refused by name rather
  // than creating one. That refusal is the correct answer — see writer.ts.
  // `onActed` is called from **inside** the write, after it lands. Calling it
  // beside `run` would flip the row to "✓ queued · undo" whether or not GitHub
  // accepted the label — and an undo button for a write that never happened is
  // worse than no feedback at all.
  const queue = () => {
    const added = initiative === "" ? [LABELS.ready] : [LABELS.ready, `${INIT_PREFIX}${initiative}`];
    ctx.actions.run(
      queueKey,
      async (writer) => {
        await writer.addLabels(issue.repoSlug, issue.number, added);
        onActed({ issue, added, verb: "queued" });
      },
      `Queued #${issue.number} on ${LABELS.ready}${initiative === "" ? "" : ` in ${initiative}`}.`,
    );
  };

  const notNow = () => {
    ctx.actions.run(
      laterKey,
      async (writer) => {
        await writer.addLabels(issue.repoSlug, issue.number, [LABELS.triaged]);
        onActed({ issue, added: [LABELS.triaged], verb: "set aside" });
      },
      `#${issue.number} is on ${LABELS.triaged} — it stops asking.`,
    );
  };

  return (
    <Row>
      <span className="grow">
        <a href={issue.url} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <span className="sm">
          #{issue.number} · filed {age(issue.createdAt)} ago
          {issue.author !== null && ` · ${issue.author}`}
          {issue.labels.length > 0 && ` · ${issue.labels.join(", ")}`}
        </span>
      </span>
      <span className="bt-row">
        {initiatives.length > 0 && (
          <select
            className="pick"
            value={initiative}
            aria-label={`Initiative for #${issue.number}`}
            onChange={(event) => setInitiative(event.target.value)}
          >
            <option value="">no initiative</option>
            {initiatives.map((card) => (
              <option key={card.name} value={card.name}>
                {card.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="bt pri" disabled={busy !== null} onClick={queue}>
          {busy === queueKey ? "…" : "Queue"}
        </button>
        <button type="button" className="bt quiet" disabled={busy !== null} onClick={notNow}>
          {busy === laterKey ? "…" : "Not now"}
        </button>
      </span>
    </Row>
  );
}

/**
 * The row a triaged issue leaves behind.
 *
 * It exists because the write works: the moment `agent:ready` lands, the refetch
 * drops the issue out of `selectTriage` and the row would vanish mid-blink. An
 * action you cannot see is an action you cannot take back, so the row stays —
 * with the one button that reverses exactly what was written — until the view
 * is left.
 */
function UndoRow({
  ctx,
  row,
  onUndone,
}: {
  ctx: Ctx;
  row: Acted;
  onUndone: (id: string) => void;
}) {
  const key = `undo:${row.issue.id}`;
  const busy = ctx.actions.busy;

  return (
    <Row>
      <span className="tick">✓</span>
      <span className="grow">
        <a href={row.issue.url} target="_blank" rel="noreferrer">
          {row.issue.title}
        </a>
        <span className="sm">
          #{row.issue.number} · {row.verb} · {row.added.join(", ")}
        </span>
      </span>
      <button
        type="button"
        className="bt"
        disabled={busy !== null}
        onClick={() => {
          ctx.actions.run(
            key,
            async (writer) => {
              for (const label of row.added) {
                await writer.removeLabel(row.issue.repoSlug, row.issue.number, label);
              }
              onUndone(row.issue.id);
            },
            `#${row.issue.number} is untriaged again.`,
          );
        }}
      >
        {busy === key ? "…" : "undo"}
      </button>
    </Row>
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
            // A card for a repo with no token goes to the gate, not to a view
            // that would only repeat that there is no token.
            onClick={() =>
              project.tokenMissing ? ctx.openTokens() : ctx.navigate(`app:${project.key}`)
            }
          >
            <span className="card__chip" aria-hidden="true">
              {project.tokenMissing ? "🔑" : "▣"}
            </span>
            <span className="card__title">{project.label}</span>
            <span className="card__body">
              {project.tokenMissing
                ? `no token for ${project.owner} — add`
                : project.searchFailed
                  ? "GitHub did not answer this repo's search"
                  : project.lastProdDeploy === null
                    ? "no production deploy seen"
                    : `prod ${age(project.lastProdDeploy.at)} ago`}
            </span>
            <span className="card__stat">
              {project.tokenMissing ? (
                <span className="muted">nothing fetched</span>
              ) : (
                <>
                  {/*
                    A failed alias fetched no rows, and the count falls back to
                    however many rows there were — so the honest card says it
                    does not know rather than printing a confident 0.
                  */}
                  <span>
                    {project.searchFailed ? (
                      <span className="muted">open PRs unknown</span>
                    ) : (
                      <>
                        <b>{project.openPrs}</b> open PRs
                      </>
                    )}
                  </span>
                  <span>
                    <b>{project.activeRuns}</b> running
                  </span>
                </>
              )}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
