# Deploying fleet-backend

The Convex project **`supa-fleet-backend`** exists (team `supa-media`) with a dev
deployment already provisioned: <https://dashboard.convex.dev/t/supa-media/supa-fleet-backend>.
`npx convex dev` in this directory picks it up from the gitignored `.env.local`.

Neither secret below is committed anywhere. Generate each with
`openssl rand -hex 32`, store it in 1Password, then:

```bash
# From apps/fleet-backend. Drop --prod to configure the dev deployment instead.
npx convex env set FLEET_BACKEND_SECRET <secret> --prod   # CI signs ingest with this
npx convex env set FLEET_READ_TOKEN <token> --prod        # the dashboard reads with this
npx convex deploy                                          # creates prod on first run; prints the URL
```

Then paste the deployment's **HTTP actions** origin — `https://<name>.convex.site`,
not `.convex.cloud` — plus the read token into the dashboard's gate, or set
`backend.url` in `packages/fleet-dashboard/src/fleet.config.ts` so every browser
gets the URL and only the token has to be typed. Until both are set the feature
is off and the dashboard behaves exactly as it did before.

Verify with `curl https://<name>.convex.site/fleet/health` → `{"ok":true}`. A
`503` from any other route means one of the two variables is unset.
