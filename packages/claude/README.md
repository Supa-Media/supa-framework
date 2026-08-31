# @supa-media/claude

**Claude Code configuration for a Supa app, kept in one place and synced in.**
Ships a `CLAUDE.md`, a conservative permissions file, an empty hooks file, and
seven slash-command templates; `supa-claude sync` copies them into your repo with
your app's name substituted, and never clobbers a file you've edited unless you
ask it to.

## Install

```bash
pnpm add -D @supa-media/claude
```

Or run it one-off, without adding a dependency:

```bash
npx @supa-media/claude sync
```

## Usage

```
npx @supa-media/claude sync              Sync templates and generate CLAUDE.md
npx @supa-media/claude sync --force      Overwrite existing files
npx @supa-media/claude sync --dry-run    Print the plan, write nothing
npx @supa-media/claude help              Show usage
```

`sync` is the only command (and the default when none is given). `--help` / `-h`
work anywhere. The project root is the nearest ancestor of the cwd containing a
`package.json`.

## What it writes

| Path | Source | Substituted |
| --- | --- | --- |
| `CLAUDE.md` (project root) | `templates/CLAUDE.md` | yes |
| `.claude/settings.json` | `templates/settings.json` | no — copied verbatim |
| `.claude/hooks.json` | `templates/hooks.json` | yes |
| `.claude/commands/*.md` | `templates/commands/` | yes |

The seven commands: `auto-worker`, `feature-validate`, `fix-ci`, `ios-build`,
`isolate`, `lock-up`, `review-cycle`.

Every file follows the same rule: **created if absent, skipped if it already
exists**, and rewritten only under `--force` (and then only when the content
actually differs). Each run prints created / updated / skipped / unchanged.

## Configuration

Values are read from `supa.config.ts`, `.js`, or `.mjs` in the project root,
falling back to `package.json`'s `name` for both name fields.

| Value | Substitutes |
| --- | --- |
| `appName` (or `name`) | `{{APP_NAME}}` |
| `displayName` | `{{APP_DISPLAY_NAME}}` (defaults to `appName`) |
| `githubOwner` (or `owner`) | the literal word `OWNER` |
| `githubRepo` (or `repo`) | the literal string `"REPO"` |

The owner/repo tokens exist for the GitHub GraphQL queries in
`commands/review-cycle.md`; leave them unset and the templates keep their
placeholders with the accompanying "replace OWNER and REPO" notes.

> **⚠️ The config file is scanned with regexes, not imported.** Each pattern
> takes the **first** match anywhere in the file, so an unrelated `name:` earlier
> in the config wins. And the GitHub substitution is a blind global replace of the
> bare word `OWNER` and the quoted string `"REPO"` — an unquoted `REPO` (e.g. in a
> `repos/OWNER/REPO/...` path) is left alone, and any other occurrence of the word
> `OWNER` in a template you add will be replaced too.

## Permissions

`templates/settings.json` ships a deliberately conservative
`permissions.allow` list — routine, reversible commands only:

- **pnpm** — `install`, and the `dev:`/`build:`/`test:`/`lint:`/`typecheck:`/`clean:`/`--filter:` prefixes, plus `convex:dashboard` and `convex:logs`
- **Convex** — `npx convex dev`, `npx convex run`, `npx convex logs`
- **Build/test** — `npx tsc`, `node --test`
- **Read-only git and gh** — `status`, `diff`, `log`, `show`, `branch`, `fetch`; `gh pr view|list|diff|checks`, `gh run view|list`, `gh api graphql`
- **Local git writes** — `git add`, `git commit`, `git checkout`

It also denies reads of `.env` and `.env.*`, at the project root and nested.

Everything not listed still prompts — deliberately. That includes `git push`,
`git reset --hard`, `git clean`, `gh pr merge`, `convex deploy`, and `eas`: the
commands that publish, deploy, or destroy work. This is a floor, not a finished
policy. **Widen it for your own repo** once you know which of those you're
comfortable granting; `sync` will not overwrite an existing
`.claude/settings.json` without `--force`, so your edits survive later syncs.

`templates/hooks.json` ships **empty** — a starting point for your own
`PreToolUse` / `PostToolUse` / `Stop` entries. Any `command` you register must
point at a script that actually exists in your repo; a missing script makes the
hook fail on every invocation.

No tests ship with this package.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework. MIT.
