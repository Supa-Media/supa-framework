import { buildMatrix, missingRequired, type MatrixCell } from "../lib/allowlist";
import { Empty, Pill, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * 🔐 Secrets — one matrix for the whole fleet.
 *
 * Rows are the union of every repo's allowlist keys; columns are repos. The
 * interesting rows are the ones where repos disagree, which is exactly what a
 * union (rather than an intersection) surfaces.
 *
 * A cell states two independent things and never conflates them:
 *
 *   ✓✓  the key is in that repo's allowlist AND a GitHub secret of that name exists
 *   ✓·  it is allowlisted, but the secret could not be checked (403 — listing
 *       secret *names* needs the token's own `Secrets: Read` permission, which
 *       is a separate fine-grained grant rather than anything to do with admin)
 *   ✗   it is allowlisted and there is no secret — the actionable case
 *   n/a the repo does not list this key at all
 *
 * There is no 1Password column with data in it. Reading 1Password needs a
 * service account that does not exist yet, and a column of plausible ticks
 * would be a lie about the one hop nobody can otherwise see.
 */
export function Secrets({ ctx }: { ctx: Ctx }) {
  const repos = ctx.snapshot.projects.filter((project) => {
    const config = ctx.config.repos.find((repo) => repo.slug.toLowerCase() === project.key);
    return config?.secretsAllowlistPath != null;
  });

  const rows = buildMatrix(
    repos.map((project) => ({
      repoKey: project.key,
      allowlist: project.allowlist,
      secretNames: project.secretNames,
    })),
  );
  const missing = missingRequired(rows);
  const anyUnknown = repos.some((project) => project.secretNames === null);

  return (
    <>
      <ViewHeader
        title="Secrets"
        sub="presence and freshness, never values — one row per key, one column per app"
      />

      {anyUnknown && (
        <p className="banner err">
          Allowlist only for at least one repo: reading GitHub&apos;s secret <em>names</em> needs a
          token with the <code>Secrets: Read</code> permission, and this one was refused. Cells show{" "}
          <code>✓·</code> — allowlisted, existence unknown — rather than guessing.
        </p>
      )}

      {missing.length > 0 && (
        <p className="banner err">
          {missing.length} required {missing.length === 1 ? "key has" : "keys have"} no GitHub
          secret: {missing.map((row) => row.key).join(", ")}.
        </p>
      )}

      {rows.length === 0 ? (
        <Empty>
          <b>No allowlists readable.</b> Each repo&apos;s path is configured in{" "}
          <code>fleet.config.ts</code>; a 404 here means the file moved, and a 403 means the token
          cannot see the repo&apos;s contents.
        </Empty>
      ) : (
        <div className="tablewrap">
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">key</th>
                {repos.map((project) => (
                  <th scope="col" key={project.key}>
                    {project.label}
                  </th>
                ))}
                <th scope="col">1Password</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="mono nowrap">
                    {row.key}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td key={repos[index]?.key ?? index}>
                      <Cell cell={cell} />
                    </td>
                  ))}
                  <td className="muted">pending service account</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rows">
        <div className="grp">
          run a sync
          <span className="r">on GitHub</span>
        </div>
        {ctx.config.repos.map((repo) => {
          if (repo.secretsSyncWorkflow === null) return null;
          const project = ctx.snapshot.projects.find(
            (candidate) => candidate.key === repo.slug.toLowerCase(),
          );
          const branch = project?.defaultBranch ?? "main";
          return (
            <div className="row" key={repo.slug}>
              <span className="grow">
                <b>{repo.label}</b>
                <span className="sm">
                  <code>{repo.secretsSyncWorkflow}</code> on <code>{branch}</code> · allowlist{" "}
                  <code>{repo.secretsAllowlistPath}</code>
                  {project?.allowlist.problem != null && ` · ${project.allowlist.problem}`}
                </span>
                <span className="sm">
                  environment: {repo.secretsSyncEnvironments.join(" · ")}
                </span>
              </span>
              <a
                className="bt"
                href={`https://github.com/${repo.slug}/actions/workflows/${encodeURIComponent(repo.secretsSyncWorkflow)}`}
                target="_blank"
                rel="noreferrer"
              >
                run sync ▶
              </a>
            </div>
          );
        })}
      </div>

      <p className="foot">
        Values live in 1Password and change there only. This page never reads a value — GitHub&apos;s
        API does not expose them.
      </p>

      <p className="foot">
        <b>The dashboard cannot dispatch a workflow, by design.</b> A fine-grained token has no
        per-workflow grant: dispatching a sync from here would require{" "}
        <code>Actions: Read and write</code> on every fleet repo, and a token sitting in this
        browser&apos;s localStorage with that scope could fire every production deploy in the fleet.
        Buying one button with that is a bad trade, so <b>run sync ▶</b> opens GitHub&apos;s own
        dispatch form — where the run is attributed to a session GitHub authenticated, and the
        environment dropdown is the workflow&apos;s own.
      </p>
    </>
  );
}

function Cell({ cell }: { cell: MatrixCell }) {
  if (cell.tier === null) return <span className="muted">n/a</span>;
  if (cell.secretExists === true) {
    return <Pill tone="g">✓✓ {cell.tier === "required" ? "req" : "opt"}</Pill>;
  }
  if (cell.secretExists === false) {
    return <Pill tone={cell.tier === "required" ? "r" : "y"}>✗ no secret</Pill>;
  }
  return <Pill>✓· {cell.tier === "required" ? "req" : "opt"}</Pill>;
}
