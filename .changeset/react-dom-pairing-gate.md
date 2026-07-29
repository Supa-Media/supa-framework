---
"@supa-media/native-safety": minor
---

`check-react-consistency` gains a third gate: react-dom/react exact pairing.
Every `react-dom` instance in the lockfile must be peer-keyed to its own exact
`react` version — a skewed pair like `/react-dom@19.2.4(react@19.1.0)` fails
the check.

Why: react-dom's server renderer hard-errors on any react/react-dom version
mismatch at runtime (React >= 19.2, `ensureCorrectIsomorphicReactVersion`),
but only when something actually renders — typecheck, bundling, and
non-rendering tests all stay green. This is exactly how Togather shipped a
broken verification email: pinning `react` in a workspace package (to control
pnpm's peer dedup) re-keyed the react-email tree onto the pin, while
`react-dom` — auto-installed as a transitive peer, declared nowhere —
stayed at the latest in-range version. The first react-email `render()` in a
Convex action then threw in production.

The gate is lockfile-wide and independent of the app's own React pin:
multiple distinct react-dom versions are fine as long as each matches the
react it's keyed to (e.g. a mobile subgraph on 19.1.0 and a web subgraph on
19.2.4). The fix it prescribes is pinning `react-dom` to the same exact
version as `react` in the workspace package that pins react.
