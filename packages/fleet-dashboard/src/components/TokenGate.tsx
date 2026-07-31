import { useState } from "react";

/**
 * The only place a token is ever entered.
 *
 * The value goes to localStorage and nowhere else: it is never bundled, never
 * sent to a server of ours (there isn't one), and every API call is made
 * browser → api.github.com. Losing the device means revoking the PAT, which is
 * why the README recommends a short expiry and Cloudflare Access in front.
 */
export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <form
      className="token-gate"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed !== "") onSubmit(trimmed);
      }}
    >
      <h2>Connect GitHub</h2>
      <p>
        Paste a fine-grained personal access token with <strong>read-only</strong> access to the
        fleet repos. It is stored in this browser&apos;s localStorage and sent only to
        api.github.com.
      </p>
      <p className="token-gate__scopes">
        Required repository permissions: <code>Contents: Read</code>, <code>Pull requests: Read</code>
        , <code>Actions: Read</code>, <code>Issues: Read</code>, <code>Metadata: Read</code>.
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
      <button type="submit" disabled={value.trim() === ""}>
        Load fleet
      </button>
    </form>
  );
}
