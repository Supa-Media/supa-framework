# Publishing a Supa app

The full lifecycle: from `create-supa-app` to a running Convex backend, a live web
build, and an iOS app on **TestFlight** with **OTA** updates.

This is the **battle-tested** path — the sibling app `events-os` was taken from
scaffold to TestFlight on it, and every gotcha below cost real debugging. Read the
[Gotchas](#gotchas) list at the bottom before your first iOS build.

> **Secrets:** this guide tells you _which_ secrets each step needs and where they
> land, but the canonical model (1Password → GitHub → server env, one-way, sync on
> change) lives in **[SECRETS.md](./SECRETS.md)**. Don't restate it — go read it.
> For the design rationale of the release/update layer, see
> **[DESIGN.md → Layer 5](./DESIGN.md)**.

---

## 0. Prerequisites

- **Node 20+** and **pnpm 8+** (`node --version`, `pnpm --version`).
- A **GitHub org** to hold the repo (e.g. `Supa-Media`).
- A **1Password vault** for this app (one vault per app — see SECRETS.md).
- A **Convex** account (free at https://convex.dev).
- An **Expo / EAS** account (free at https://expo.dev).
- **For iOS:**
  - An **Apple Developer Program** membership (paid, the team that will own the app).
  - An **App Store Connect API key** — a `.p8` file plus its **Key ID** and the
    account **Issuer ID** (App Store Connect → Users and Access → Integrations →
    App Store Connect API). This is what lets EAS create certs/profiles and submit
    builds without Apple 2FA prompts.

---

## 1. Scaffold and run locally

```bash
# Clone the framework and run the scaffolder locally
git clone https://github.com/Supa-Media/supa-framework.git
cd supa-framework
pnpm install
node packages/create-supa-app/src/index.js my-app
cd my-app
pnpm install
npx convex dev          # creates your personal Convex dev deployment, writes EXPO_PUBLIC_CONVEX_URL
pnpm dev                # Convex + Expo together (web at http://localhost:8081)
```

`npx convex dev` writes `CONVEX_DEPLOYMENT` and **`EXPO_PUBLIC_CONVEX_URL`** into
`.env.local`. That `EXPO_PUBLIC_CONVEX_URL` is load-bearing in every later step —
it gets **inlined into the JS bundle at build time** (see the
[crash trap](#gotchas)).

For full first-run onboarding (secrets, seed data), see the scaffolded app's own
`CLAUDE.md`.

---

## 2. GitHub repo

Create the repo under your org and push `main`:

```bash
gh repo create Supa-Media/my-app --private --source=. --remote=origin
git push -u origin main
```

The scaffold already ships `.github/workflows/` that call the framework's reusable
workflows (`ci.yml`, `deploy-convex.yml`, `deploy-mobile-update.yml`, and the web
deploy). They run on merge to `main`.

---

## 3. Secrets model (read SECRETS.md, then fill the vault)

**1Password is the source of truth.** Each secret is a **Secure Note** named exactly
like its env var, with three fields: **`dev` / `staging` / `production`**. A
read-only OP **service-account token** lives in GitHub as `OP_SERVICE_ACCOUNT_TOKEN`
and is the only bootstrap secret; everything else flows OP → GitHub Environment
secrets → server env, and you **re-sync only when a value changes**.

Standard items for a Supa app:

| Secret | Used by | Notes |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | Convex deploy | per environment (production / staging) |
| `EXPO_TOKEN` | EAS build / update / web deploy | Expo robot token |
| `EXPO_PUBLIC_CONVEX_URL` | **every bundle step** | env-specific; inlined at build time |
| `JWT_PRIVATE_KEY` + `JWKS` | Convex auth | **must be a matching pair** |
| `SITE_URL` | Convex auth callbacks | env-specific |
| `AUTH_EMAIL_FROM` | Resend OTP email | must be a **Resend-verified domain** |
| `RESEND_API_KEY` | email OTP | |
| `OPENROUTER_API_KEY` | LLM features | if used |
| `ASC_API_KEY_P8` / `ASC_KEY_ID` / `ASC_ISSUER_ID` | iOS build + submit | App Store Connect API key |
| `OP_SERVICE_ACCOUNT_TOKEN` | OP→GitHub sync | the one bootstrap secret, GitHub-only |

> Details on _why_ this shape, the sync workflow, and who reads what:
> **[SECRETS.md](./SECRETS.md)**.

---

## 4. Deploy Convex (production)

1. Generate a **production deploy key** in the Convex dashboard (Settings → Deploy
   keys) and store it in the GitHub **`production` Environment** as
   `CONVEX_DEPLOY_KEY`.
2. On merge to `main`, the `deploy-convex.yml` workflow runs `npx convex deploy`
   against production.
3. Set the production deployment's env vars. Multi-line PEM values (`JWT_PRIVATE_KEY`,
   `JWKS`) **must be piped via stdin**, not passed as a CLI arg (a multi-line arg
   gets mangled):

   ```bash
   npx convex env set JWT_PRIVATE_KEY --prod < jwt_private_key.txt
   npx convex env set JWKS            --prod < jwks.txt
   npx convex env set SITE_URL "https://my-app.com" --prod
   npx convex env set AUTH_EMAIL_FROM "auth@my-app.com" --prod   # Resend-verified domain
   npx convex env set RESEND_API_KEY "re_..." --prod
   npx convex env set OPENROUTER_API_KEY "sk-or-..." --prod
   ```

   `JWT_PRIVATE_KEY` and `JWKS` **must be a matching keypair** — a mismatched pair
   means tokens sign but never verify, and every login silently fails.

> **Schema-migration gotcha:** production has its own data. If you rename or retype
> a schema field, `convex deploy` is **rejected by schema validation** against the
> existing prod docs. Run the migration on prod **in the right order** (add the new
> field, backfill, then drop the old) before the deploy that enforces the new shape.

---

## 5. Deploy web (EAS Hosting)

The web build is just Expo's web target exported and pushed to EAS Hosting. CI does
this on merge to `main`; locally it's:

```bash
cd apps/mobile
EXPO_PUBLIC_CONVEX_URL="https://<prod>.convex.cloud" npx expo export --platform web
npx eas-cli deploy --prod
```

Needs **`EXPO_TOKEN`** and **`EXPO_PUBLIC_CONVEX_URL`** (the export inlines the URL —
see the [crash trap](#gotchas)).

**Custom domain (optional):** point a `CNAME` at `origin.expo.app`, **then register
the domain in the EAS Hosting dashboard**. DNS alone won't issue the TLS cert — the
dashboard registration is what triggers issuance.

---

## 6. Link the EAS project

The scaffold ships `app.config.js` and `eas.json` with **placeholders**. Link a real
EAS project to fill them:

```bash
cd apps/mobile
eas init        # creates @owner/slug and a projectId
```

Then replace the placeholders:

- `app.config.js`: `extra.eas.projectId` and `updates.url`
  (`https://u.expo.dev/<projectId>`) — both currently `YOUR_EAS_PROJECT_ID`.
- `app.config.js`: `owner` — your Expo owner.

> **`eas init` validation gotcha:** the scaffold's `eas.json` has an empty
> `submit.production.ios` block (`appleId`/`ascAppId`/`appleTeamId` = `""`). Empty
> placeholder strings **fail `eas init` validation** — delete the empty
> `submit.ios` block (or fill the values) before running `eas init`. You'll fill
> `ascAppId` for real in [step 7](#7-ios-build--testflight).

---

## 7. iOS build → TestFlight

This is the hard part. Do the **first** credential setup interactively, then every
later build/submit is non-interactive.

### 7a. Set the ASC API key as EAS env vars

So EAS can talk to Apple without 2FA prompts. Point at the `.p8` and set the IDs as
**EAS environment variables** (production):

```bash
export EXPO_ASC_API_KEY_PATH=./AuthKey_XXXX.p8
export EXPO_ASC_KEY_ID=XXXXXXXXXX
export EXPO_ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 7b. First build (interactive — creates certs + profile)

```bash
cd apps/mobile
eas build -p ios --profile production
```

Run it **without** `--non-interactive` the first time: EAS creates the distribution
certificate and provisioning profile. With the ASC key env set, it won't need Apple
2FA. **After this once, builds are non-interactive.**

Things that bite here:

- **Apple Team ID** is the team the **ASC key** belongs to — **not** necessarily the
  dev cert in your local keychain. Find it via the `seedId` returned for a bundle ID
  through the App Store Connect API, or read it off the `eas build` output.
- **`GITHUB_TOKEN` must be an EAS env var (production).** EAS Build runs
  `pnpm install` on its own runner, and the private `@supa-media/*` packages come
  from **GitHub Packages** — which needs a token even for public packages. Without
  it, install fails on the EAS runner. Also ensure the **lockfile resolves
  `@supa-media/*` from the registry**, not from local `file:` tarball overrides — a
  `file:` override won't exist on the EAS runner.
- **App icons must be valid PNGs.** A stray UTF-8 text pass over an icon corrupts it
  (the `0x89` PNG header byte becomes the U+FFFD replacement char), and
  `expo prebuild`'s image step (jimp) crashes with
  `Could not find MIME for Buffer <null>`. If you see that, re-export the icon as a
  real PNG.
- **Provisioning-profile entitlement mismatch.** If `app.config.js` declares Push
  (`aps-environment`) or Associated Domains but the profile doesn't include them,
  the Xcode build fails. Fix by enabling the capability on the **App ID** (App Store
  Connect API). If EAS reuses a **stale cached profile**, delete it from EAS's store
  (GraphQL `deleteAppleProvisioningProfile`) so it regenerates. Drop entitlements you
  don't use — e.g. the scaffold ships `ios.associatedDomains: []`; leave it empty/
  removed unless you actually use universal links.
- **`ITSAppUsesNonExemptEncryption: false`** in `ios.infoPlist` skips the
  export-compliance prompt on every TestFlight upload. Set it.
- **`EXPO_PUBLIC_CONVEX_URL` must be present at build time** (EAS env var). It's
  inlined into the bundle; if missing, the Convex client gets `undefined` and the app
  crashes on launch. The framework now renders a visible **"Configuration error"**
  screen instead of an opaque crash — but you still must set the var.

### 7c. First submit (interactive — creates the App Store Connect app record)

The App Store Connect **app record cannot be created via the ASC API.** Run submit
interactively once; it walks you through name / SKU / primary language and creates
the app:

```bash
eas submit -p ios --latest
```

Then copy the resulting **`ascAppId`** into `eas.json` →
`submit.production.ios.ascAppId` (along with `appleId` and `appleTeamId`). Future
submits are non-interactive:

```bash
eas submit -p ios --latest --non-interactive
```

---

## 8. OTA updates (EAS Update)

JS-only changes ship over the air without a new binary. CI publishes on merge to
`main` via `deploy-mobile-update.yml`, which first runs a **fingerprint check** —
if native code changed, it refuses the OTA and tells you a new build is required.

The **channel a build reads is fixed at build time** (`eas.json` → `production`
build sets `channel: "production"`). EAS Update routes a channel to a **branch**, so
publish to the branch the channel points at:

```bash
eas update --branch production --message "fix: ..."
```

> **Don't use `--auto`** for this — `--auto` publishes to a branch named after the
> _git_ branch, which the `production` channel isn't pointing at, so installed apps
> never receive it.

**The `EXPO_PUBLIC_CONVEX_URL` crash trap applies to `eas update` too.** The OTA
bundle is exported in CI; a missing var ships a bundle with `undefined` that
**crashes installed builds on the same runtimeVersion** — an OTA can break a working
native build. The scaffolded workflow wires the var; keep it wired.

OTA **cannot** change native code. New native deps or config-plugin changes need a
new `eas build` (the fingerprint check catches this for you).

---

## 9. Getting it onto a phone

1. App Store Connect → your app → **TestFlight**.
2. **Internal Testing** → add testers (people on your team / App Store Connect
   account). They get the build **instantly, no Apple review.**
3. **External Testing** needs a filled-in **Test Information** form and a quick Apple
   review before the first build reaches external testers.

Testers install the **TestFlight** app and accept the invite.

---

## Gotchas

A tight checklist — every one of these cost real debugging on `events-os`:

- **`EXPO_PUBLIC_CONVEX_URL` is inlined at build/export time**, not read at runtime.
  It must be set for `eas build`, `eas update`, **and** `expo export` (web). Missing
  → app crashes (now shows a "Configuration error" screen). See
  [SECRETS.md](./SECRETS.md#build-time-public-vars-expo_public_--the-crash-trap).
- **Convex prod schema migrations:** rename/retype a field and `convex deploy` is
  rejected by validation against existing prod data. Migrate in order first.
- **`JWT_PRIVATE_KEY` + `JWKS` must match.** A mismatched pair signs tokens that
  never verify; logins fail silently. Set multi-line PEMs via stdin
  (`convex env set NAME --prod < file`), not as a CLI arg.
- **`AUTH_EMAIL_FROM` must be a Resend-verified domain**, or OTP emails never send.
- **`eas init` fails on empty `submit.ios` placeholders.** Delete the empty
  `appleId`/`ascAppId`/`appleTeamId` strings (or fill them) first.
- **Apple Team ID = the team the ASC _key_ belongs to**, not your local dev cert's
  team. Get it from the bundle ID's `seedId` (ASC API) or the `eas build` output.
- **First `eas build -p ios` must be interactive** to create the cert + profile.
  With `EXPO_ASC_*` env set it skips 2FA. After once, builds are non-interactive.
- **`GITHUB_TOKEN` must be an EAS env var** so EAS Build's `pnpm install` can pull
  private `@supa-media/*` from GitHub Packages. The lockfile must resolve them from
  the **registry**, not a local `file:` tarball override.
- **App icons must be valid PNGs.** A UTF-8 text pass corrupts the `0x89` header and
  jimp crashes with "Could not find MIME for Buffer".
- **Provisioning-profile entitlement mismatch** (Push / Associated Domains): enable
  the capability on the App ID, delete the stale EAS-cached profile
  (`deleteAppleProvisioningProfile`) so it regenerates, and drop unused entitlements
  (e.g. empty `ios.associatedDomains`).
- **`ITSAppUsesNonExemptEncryption: false`** skips the export-compliance prompt.
- **The App Store Connect app record can't be created via the ASC API.** Run
  `eas submit -p ios --latest` interactively once, then put `ascAppId` in `eas.json`
  for non-interactive submits.
- **OTA: publish to the branch the channel points at** (`eas update --branch
  production`), not `--auto`. And the `EXPO_PUBLIC_CONVEX_URL` trap applies — a bad
  OTA crashes installed apps on the same runtimeVersion.
