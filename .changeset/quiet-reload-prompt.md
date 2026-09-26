---
"@supa-media/core": minor
---

`SupaConvexProvider` accepts `unsavedChangesWarning` and forwards it to `ConvexReactClient`. Convex's browser client prompts "Changes you made may not be saved" on reload whenever any mutation or action is in flight, including read-only actions; an app with its own unsaved-work guard can now pass `false` to stop that false alarm. Unset keeps Convex's default.
