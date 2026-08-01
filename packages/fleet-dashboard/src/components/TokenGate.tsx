import { useState } from "react";

/**
 * The only place a token is ever entered.
 *
 * The value goes to localStorage and nowhere else: it is never bundled, never
 * sent to a server of ours (there isn't one), and every API call is made
 * browser → api.github.com. Losing the device means revoking the PAT, which is
 * why the README recommends a short expiry and Cloudflare Access in front.
 *
 * v2 needs **write** on issues, because the review screen's controls are label
 * and comment writes. That is a real escalation from v1's read-only token and
 * the copy says so rather than burying it — the same PAT can now relabel and
 * comment on every repo in the fleet.
 *
 * It needs write on **nothing else**. An earlier draft asked for `Actions: Read
 * and write` to dispatch the secrets sync; that grant is per-repo, not
 * per-workflow, so it would also have let this token fire
 * `deploy-to-production.yml`, `deploy-production.yml`, and `deploy-convex.yml`
 * across the fleet — every production deploy there is — to buy one button. The
 * button is a deep link now and the scope is gone. The list below is what to
 * mint, and the last line is what it deliberately cannot do.
 */
export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <form
      className="gate"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed !== "") onSubmit(trimmed);
      }}
    >
      <h2>supa fleet</h2>
      <p>
        Paste a fine-grained personal access token scoped to the fleet repos. It is stored in this
        browser&apos;s localStorage and sent only to api.github.com.
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
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="github_pat_..."
        aria-label="GitHub personal access token"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="bt pri" disabled={value.trim() === ""}>
        Load fleet
      </button>
    </form>
  );
}
