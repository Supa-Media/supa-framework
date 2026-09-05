---
"@supa-media/core": patch
---

Declare `features.desktop` and `features.appleTargets` in `FeaturesConfig`.

Both already typechecked through the interface's index signature, but a flag
`create-supa-app` writes into every generated `supa.config.ts` should be
discoverable in the type rather than inferred from the scaffolder.
