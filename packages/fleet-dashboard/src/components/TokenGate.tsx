import { useState } from "react";

import { normalizeBackendUrl, type StoredBackend } from "../lib/backend";
import {
  hasAnyToken,
  mergeTokens,
  repoName,
  tokenForOwner,
  type OwnerGroup,
  type TokenMap,
} from "../lib/tokens";

/**
 * The only place a token is ever entered — one field per resource owner.
 *
 * **Why three fields.** A fine-grained personal access token is scoped to
 * exactly one resource owner, and this fleet spans three of them:
 * `togathernyc`, `Supa-Media`, and `shyoh`. There is no token that can read all
 * four repos, so there is no single field that could take one. v2 had one field
 * and sent its value everywhere, which is why two thirds of the fleet answered
 * `NOT_FOUND` and looked like a config bug.
 *
 * Values go to localStorage and nowhere else: never bundled, never sent to a
 * server of ours (there isn't one), every API call browser → api.github.com.
 * Losing the device means revoking three PATs, which is why the README
 * recommends a short expiry and Cloudflare Access in front.
 *
 * **Partial is a supported state.** Filling in one field loads that owner's
 * repos; the rest render a "no token for <owner>" card that comes back here.
 * That is deliberate — one expired PAT should cost you one card, not the page.
 *
 * v2 needs **write** on issues, because the review screen's controls are label
 * and comment writes. That is a real escalation from v1's read-only token and
 * the copy says so rather than burying it — each PAT can relabel and comment on
 * the repos it covers.
 *
 * It needs write on **nothing else**. An earlier draft asked for `Actions: Read
 * and write` to dispatch the secrets sync; that grant is per-repo, not
 * per-workflow, so it would also have let these tokens fire
 * `deploy-to-production.yml`, `deploy-production.yml`, and `deploy-convex.yml`
 * across the fleet — every production deploy there is — to buy one button. The
 * button is a deep link now and the scope is gone. The list below is what to
 * mint, identically for each owner, and the last line is what it deliberately
 * cannot do.
 *
 * **The backend row is optional and starts empty.** It points this browser at
 * the fleet's own Convex backend (`apps/fleet-backend`) so the review marker
 * follows you between devices and the run telemetry the fleet's jobs post
 * becomes visible. Left blank, no request is made anywhere but api.github.com
 * and the marker stays in this browser — which is exactly how the dashboard
 * behaved before the backend existed. The read token is stored like the PATs
 * are, and **"Sign out all" forgets it too**.
 */
export function TokenGate({
  owners,
  saved,
  backend,
  configuredBackendUrl,
  onSubmit,
  onCancel,
}: {
  owners: Array<OwnerGroup>;
  /** What is already stored. Values are never rendered — only their presence. */
  saved: TokenMap;
  /** The optional Convex backend's stored URL + read token, if this browser has one. */
  backend: StoredBackend;
  /** `fleet.config.ts`'s URL, shown as the default this browser would otherwise use. */
  configuredBackendUrl: string | null;
  onSubmit: (tokens: TokenMap, backend: StoredBackend) => void;
  /** `null` on first load, when there is nothing to go back to. */
  onCancel: (() => void) | null;
}) {
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [backendUrl, setBackendUrl] = useState(backend.url ?? "");
  const [readToken, setReadToken] = useState("");

  const merged = mergeTokens(saved, entered);
  const missing = owners.filter((group) => tokenForOwner(merged, group.owner) === null);

  const trimmedUrl = backendUrl.trim();
  // Only complain about a URL someone actually typed. An empty field is the
  // supported "no backend" state, not a mistake to nag about.
  const urlLooksWrong = trimmedUrl !== "" && normalizeBackendUrl(trimmedUrl) === null;

  return (
    <form
      className="gate"
      onSubmit={(event) => {
        event.preventDefault();
        if (!hasAnyToken(merged) || urlLooksWrong) return;
        onSubmit(merged, {
          url: trimmedUrl === "" ? null : trimmedUrl,
          // Blank keeps the stored token, exactly as a blank PAT field does —
          // the common visit here is "one credential expired", not "re-enter
          // everything I have".
          readToken: readToken.trim() === "" ? backend.readToken : readToken.trim(),
        });
      }}
    >
      <h2>supa fleet</h2>
      <p>
        A fine-grained personal access token is scoped to <b>one resource owner</b>, and this fleet
        spans three — so it takes three tokens. Each is stored in this browser&apos;s localStorage
        and sent only to api.github.com. Any one of them is enough to start: the owners you skip
        show a &ldquo;no token&rdquo; card instead of loading.
      </p>

      {owners.map((group) => {
        const stored = tokenForOwner(saved, group.owner) !== null;
        const fieldId = `token-${group.owner}`;
        return (
          <div className="gate__field" key={group.owner}>
            <label htmlFor={fieldId}>
              {group.owner}
              <span className="gate__repos">
                {group.repos.map((repo) => repoName(repo.slug)).join(", ")}
              </span>
            </label>
            <input
              id={fieldId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={stored ? "saved — paste to replace" : "github_pat_..."}
              aria-label={`GitHub token for ${group.owner}`}
              value={entered[group.owner] ?? ""}
              onChange={(event) =>
                setEntered((current) => ({ ...current, [group.owner]: event.target.value }))
              }
            />
          </div>
        );
      })}

      <p>
        Mint each one at <code>Settings → Developer settings → Fine-grained tokens</code>, scoped to
        that owner&apos;s repos, with the <b>same permissions every time</b>:
      </p>
      <ul>
        <li>
          <code>Issues: Read and write</code> — labels, comments, and filing dumps. This is what the
          review controls use.
        </li>
        <li>
          <code>Pull requests: Read</code> — shipped list, open work, review state
        </li>
        <li>
          <code>Actions: Read</code> — run history, deploy state, gardener runs. Read only.
        </li>
        <li>
          <code>Contents: Read</code> — gardener sources, allowlists, initiative manifests
        </li>
        <li>
          <code>Metadata: Read</code> — mandatory for every fine-grained token
        </li>
        <li>
          <code>Secrets: Read</code> — optional. Without it the secrets matrix shows the allowlist
          only, never a wrong answer.
        </li>
      </ul>
      <p>
        Issues read/write, everything else read. <b>The dashboard cannot dispatch a workflow by
        design</b> — so a token pasted here can never start a deploy, and <b>run sync ▶</b> is a
        link to GitHub&apos;s own dispatch form.
      </p>

      <div className="gate__field">
        <label htmlFor="backend-url">
          fleet backend <span className="gate__repos">optional — review marker + run telemetry</span>
        </label>
        <input
          id="backend-url"
          type="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={configuredBackendUrl ?? "https://<deployment>.convex.site"}
          aria-label="Fleet backend URL"
          value={backendUrl}
          onChange={(event) => setBackendUrl(event.target.value)}
        />
        <input
          id="backend-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={backend.readToken === null ? "read token" : "saved — paste to replace"}
          aria-label="Fleet backend read token"
          value={readToken}
          onChange={(event) => setReadToken(event.target.value)}
        />
      </div>
      <p className="gate__note">
        Leave both blank and nothing changes: the review marker stays in this browser and no request
        leaves for anywhere but api.github.com. Fill them in and the marker follows you between
        devices, and the ◉ views gain what the fleet&apos;s own jobs reported while running —
        watchdog wakes, respawns, decisions — which the GitHub API cannot see.{" "}
        <b>GitHub stays the source of truth for work state</b>; the backend only holds what GitHub
        has nowhere to put.
      </p>
      {urlLooksWrong && (
        <p className="gate__note">
          That is not a backend URL. The value wanted is the deployment&apos;s HTTP actions origin,{" "}
          <code>https://&lt;name&gt;.convex.site</code> — not the <code>.convex.cloud</code> one,
          which is the other hostname every Convex deployment has and the easier of the two to
          paste by mistake.
        </p>
      )}

      {missing.length > 0 && hasAnyToken(merged) && (
        <p className="gate__note">
          Loading without {missing.map((group) => group.owner).join(" and ")} —{" "}
          {missing.flatMap((group) => group.repos.map((repo) => repo.label)).join(", ")} will show a
          &ldquo;no token&rdquo; card until you add {missing.length === 1 ? "it" : "them"}.
        </p>
      )}

      <div className="gate__foot">
        <button type="submit" className="bt pri" disabled={!hasAnyToken(merged) || urlLooksWrong}>
          {onCancel === null ? "Load fleet" : "Save tokens"}
        </button>
        {onCancel !== null && (
          <button type="button" className="bt quiet" onClick={onCancel}>
            back
          </button>
        )}
      </div>
    </form>
  );
}
