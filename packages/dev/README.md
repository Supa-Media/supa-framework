# @supa-media/dev

**One command that starts a Convex + Expo app.** `supa-dev` runs the Convex dev
server and Metro together in one terminal with labeled, colored output, and
handles the small chores that otherwise cost you the first five minutes of every
session: a stale lockfile, a leftover process squatting on the Metro port, and
wiring `EXPO_PUBLIC_CONVEX_URL` through to Expo.

## Install

```bash
pnpm add -D @supa-media/dev
```

Then wire it up at the workspace root:

```json
{
  "scripts": {
    "dev": "supa-dev",
    "dev:mobile": "supa-dev --mobile",
    "dev:convex": "supa-dev --convex"
  }
}
```

## Flags

| Flag | What runs |
| --- | --- |
| *(none)* | Convex dev **and** `expo start --web` |
| `--convex` | Convex dev only |
| `--mobile` | Expo only, no platform flag (Expo picks) |
| `--web` | Expo only, `--web` |
| `--ios` | Expo only, `--ios` |
| `--android` | Expo only, `--android` |

Flags are matched by exact presence in `process.argv`; unknown arguments are
ignored. `--convex` suppresses Expo even if another platform flag is also passed.

## What it does, in order

1. **Finds the workspace root** by walking up from the cwd for a
   `pnpm-workspace.yaml` or `pnpm-lock.yaml`.
2. **Loads `supa.config.js` / `supa.config.ts`** from that root, if present
   (`.ts` needs `tsx` or `ts-node` resolvable). Reads `dev.metroPort`
   (default `8081`) and `convex.functionsDir`.
3. **Reinstalls if the lockfile moved.** Compares `pnpm-lock.yaml`'s mtime+size
   against a marker at `node_modules/.pnpm-lock-hash` and runs `pnpm install`
   when they differ (or when `node_modules` is missing).
4. **Resolves the Convex URL** — `EXPO_PUBLIC_CONVEX_URL` from the environment,
   else from `.env.local`, else derived from `CONVEX_DEPLOYMENT` as
   `https://<slug>.convex.cloud` — and passes it to the Expo child process.
5. **Spawns** `npx convex dev [--functions <dir>]` from the workspace root, and
   `npx expo start --port <port> [platform flag]` from the first of
   `apps/mobile`, `apps/expo`, or the root that contains an `app.json` /
   `app.config.js` / `app.config.ts`.

Before starting Expo it frees the Metro port by `lsof`-ing the listener and
`kill -9`ing it. `SIGINT`/`SIGTERM` shuts both children down, and if either child
exits non-zero the other is killed too.

> **⚠️ Two side effects you should know about before wiring this into a script.**
> It will run `pnpm install` on your behalf when the lockfile has changed, and it
> will kill whatever is listening on the Metro port — including an unrelated
> process on 8081. Both are unconditional. `lsof`/`kill` also means macOS and
> Linux only.

Running with `--mobile`, `--web`, `--ios`, or `--android` and no reachable Convex
URL exits 1 rather than starting Expo against nothing.

## Programmatic use

`require("@supa-media/dev")` exposes `run()` (the same entry point the bin calls,
reading `process.argv` itself) plus the helpers `findWorkspaceRoot`,
`getConvexUrl`, `ensureDependencies`, and `killProcessOnPort`.

No tests ship with this package.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework. MIT.
