/**
 * The fleet: which repos this dashboard watches, how to recognize a deploy, and
 * where each repo keeps the files the dashboard reads.
 *
 * Everything here is public information (repo slugs, workflow filenames, file
 * paths). The GitHub tokens are NOT here — they are entered in the UI at runtime
 * and kept in localStorage, one per repo owner. See README.md.
 *
 * The fleet spans three resource owners (`togathernyc`, `Supa-Media`, `shyoh`)
 * and a fine-grained PAT is scoped to one of them, so adding a repo under a new
 * owner adds a token field to the gate automatically — the owner is derived from
 * `slug`. See `lib/tokens.ts`.
 */

export interface RepoConfig {
  /**
   * `owner/name` exactly as GitHub spells it.
   *
   * The `owner` half is load-bearing beyond the URL: a fine-grained PAT is
   * scoped to exactly **one** resource owner, so this is what selects the token
   * every request for this repo is made with (`lib/tokens.ts`). It is derived,
   * never configured beside the slug — a second field saying the same thing is
   * a second field that can disagree with the first.
   */
  slug: string;
  /** Short label for the project card. */
  label: string;
  /**
   * Workflow *filenames* (not display names) whose latest successful run counts
   * as "last deploy". Verified against `gh api repos/<slug>/actions/workflows`
   * on 2026-07-31.
   */
  deployWorkflows: string[];
  /**
   * Workflow filename whose latest successful run counts as a **production**
   * deploy, for the Review screen's "did this reach prod?" column. Distinct
   * from `deployWorkflows`, which is the union of every deploy target — staging
   * deploys are automatic on merge and therefore uninteresting, prod is the one
   * that needs a human. `null` when the repo has no separate prod deploy.
   */
  productionWorkflow: string | null;
  /**
   * Path to the repo's 1Password → GitHub secrets allowlist. Every repo in the
   * fleet has one and every repo puts it somewhere different, which is exactly
   * why the Secrets matrix exists. Verified against each repo on 2026-08-01:
   *   togather   ee/secrets-allowlist.json
   *   events-os  .github/secrets-allowlist.json
   *   fount      scripts/secrets-allowlist.json
   * `null` when the repo syncs no secrets (the framework itself).
   */
  secretsAllowlistPath: string | null;
  /**
   * The repo's secrets-sync workflow filename, and the `environment` input
   * values it accepts. events-os names this `sync-github-secrets.yml`; everyone
   * else `sync-secrets.yml`.
   *
   * The Secrets view **deep-links** to this workflow's page on GitHub rather
   * than dispatching it: dispatch from here would need `Actions: Read and write`
   * on every repo, which is a token that can fire every production deploy in the
   * fleet — see the note in `sources/github/writer.ts`. The environments are
   * listed so the page tells you which value to pick when you get there.
   */
  secretsSyncWorkflow: string | null;
  secretsSyncEnvironments: string[];
}

/**
 * The fleet's own Convex backend (`apps/fleet-backend` in this repo), which
 * holds the two things GitHub cannot: your cross-device review marker, and run
 * telemetry the fleet's jobs post about themselves.
 *
 * `url` is the deployment's **HTTP actions** origin — the `.convex.site` one,
 * not `.convex.cloud`. It is public in the same way a repo slug is: it ships in
 * the bundle and grants nothing on its own, because every route wants a
 * credential. The read token is NOT here — it is entered in the gate and kept
 * in that browser's localStorage, like the PATs.
 *
 * `null` means the feature is off: no request is made, the review marker stays
 * in localStorage, and the page behaves exactly as it did before the backend
 * existed. A browser can still opt in on its own by entering a URL in the gate.
 */
export interface BackendBlock {
  url: string | null;
}

export interface FleetConfig {
  name: string;
  /** GitHub login whose review requests populate the NEEDS YOU row. */
  owner: string;
  repos: RepoConfig[];
  /**
   * Title of the gh-aw cost issue to parse for gardener spend. Matched
   * case-insensitively as a substring of the issue title.
   */
  costIssueTitle: string;
  /**
   * Filename glob (prefix + suffix) identifying a compiled gh-aw gardener
   * workflow. `gardener-triage.lock.yml` matches; its markdown source is the
   * same path with `.lock.yml` swapped for `.md`.
   */
  gardenerPrefix: string;
  gardenerSuffix: string;
  /**
   * Repo-relative path to the optional initiative manifest the Apps view reads
   * for phase chips. Absent file → the branch/label heuristic stands alone.
   * Schema documented in `lib/initiativesFile.ts`.
   */
  initiativesPath: string;
  /**
   * `https://t.me/<bot>` — the 🎙 course-correct button on Review and in
   * Copilot's footer — or `null` when no bot exists yet.
   *
   * Nullable on purpose. The Telegram worker (which files `inbox:proposed`
   * issues from a voice note) is a separate, unbuilt workstream, and a primary
   * button on the home screen pointing at a bot that does not answer is a dead
   * end dressed as a feature. `null` renders a "not wired yet" state instead;
   * putting a URL here is the whole of turning it on.
   */
  telegramUrl: string | null;
  /** Where the ⌘K palette's "open Claude Code" action points. */
  claudeCodeUrl: string;
  /** See `BackendBlock`. `{ url: "https://exuberant-robin-705.convex.site" }` turns the whole feature off. */
  backend: BackendBlock;
  /** Static reference links for the ＋ New app checklist. */
  newAppLinks: { label: string; url: string }[];
  /** The watchdog ladder, rendered as static content on the 🐕 view. */
  watchdogLadder: { rung: string; tone: "n" | "y" | "r"; title: string; body: string }[];
  /** The watchdog policy line, likewise static. */
  watchdogPolicy: string;
}

export const fleetConfig: FleetConfig = {
  name: "Supa Fleet",
  owner: "lilseyi",
  costIssueTitle: "[gardeners] weekly cost & activity report",
  gardenerPrefix: "gardener-",
  gardenerSuffix: ".lock.yml",
  initiativesPath: ".fleet/initiatives.json",
  // No bot yet — `t.me/SupaFleetBot` was a placeholder that resolved to nothing.
  // Set this to the real `https://t.me/<bot>` the day the Telegram worker ships.
  telegramUrl: null,
  claudeCodeUrl: "https://claude.ai/code",
  // Off until `apps/fleet-backend` has a production deployment. Set this to
  // that deployment's `.convex.site` origin (see apps/fleet-backend/DEPLOY.md)
  // and the review marker starts following you between devices. Until then a
  // single browser can point itself at one from the gate's settings row.
  backend: { url: null },
  repos: [
    {
      slug: "togathernyc/togather",
      label: "Togather",
      // "Deploy to Production" + "Deploy Convex"
      deployWorkflows: ["deploy-to-production.yml", "deploy-convex.yml"],
      productionWorkflow: "deploy-to-production.yml",
      secretsAllowlistPath: "ee/secrets-allowlist.json",
      secretsSyncWorkflow: "sync-secrets.yml",
      // `both` is in the workflow's own `choice` options and is the value
      // togather's CLAUDE.md tells maintainers to use.
      secretsSyncEnvironments: ["staging", "production", "both"],
    },
    {
      slug: "Supa-Media/events-os",
      label: "Events OS",
      // events-os names every deploy workflow "… (production)"
      deployWorkflows: ["deploy-convex.yml", "deploy-web.yml", "deploy-landing.yml"],
      productionWorkflow: "deploy-convex.yml",
      secretsAllowlistPath: ".github/secrets-allowlist.json",
      // Not `sync-secrets.yml` — that one pushes Convex env vars. The allowlist
      // above is consumed by `sync-github-secrets.yml`.
      secretsSyncWorkflow: "sync-github-secrets.yml",
      secretsSyncEnvironments: ["production", "staging"],
    },
    {
      slug: "shyoh/fount-studios",
      label: "Fount Studios",
      // "Deploy to Production" lives at deploy-production.yml here, not
      // deploy-to-production.yml as in togather.
      deployWorkflows: ["deploy-production.yml"],
      productionWorkflow: "deploy-production.yml",
      secretsAllowlistPath: "scripts/secrets-allowlist.json",
      secretsSyncWorkflow: "sync-secrets.yml",
      secretsSyncEnvironments: ["staging", "production", "both"],
    },
    {
      slug: "Supa-Media/supa-framework",
      label: "Supa Framework",
      // The framework has no app deploy — shipping it means publishing packages.
      deployWorkflows: ["release.yml"],
      productionWorkflow: "release.yml",
      // The framework ships the sync tooling; it holds no app secrets itself.
      secretsAllowlistPath: null,
      secretsSyncWorkflow: null,
      secretsSyncEnvironments: [],
    },
  ],
  newAppLinks: [
    {
      label: "create-supa-app — scaffold the repo",
      url: "https://github.com/Supa-Media/supa-framework/tree/main/packages/create-supa-app",
    },
    {
      label: "Terraform — DNS + Cloudflare records",
      url: "https://github.com/Supa-Media/supa-framework/tree/main/infra",
    },
    { label: "Convex — create staging + production deployments", url: "https://dashboard.convex.dev" },
    { label: "EAS — init the mobile project", url: "https://expo.dev/accounts" },
    { label: "App Store Connect — app record + listing", url: "https://appstoreconnect.apple.com" },
    { label: "Google Play Console — app record + listing", url: "https://play.google.com/console" },
  ],
  watchdogLadder: [
    {
      rung: "L1",
      tone: "n",
      title: "Orchestrator self-check",
      body: "At every unit boundary: is the goal evidenced done? Tests, screenshot, diff. Its own judge bounces “looks done”.",
    },
    {
      rung: "L2",
      tone: "n",
      title: "Watchdog wake",
      body: "Liveness, progress-per-dollar, budget, API health, orphaned claims. An anomaly gets diagnosed, not just alerted.",
    },
    {
      rung: "L3",
      tone: "y",
      title: "Kill & respawn",
      body: "An agent looping or stalled with no external cause is killed, a context sheet is written (what it tried, what failed, what is left), and a fresh agent is spawned with the sheet plus the original goal. Max 3 respawns.",
    },
    {
      rung: "L4",
      tone: "r",
      title: "Park or page",
      body: "Three respawns burned → park it for the next review with the sheet. A human-only blocker (a key, a permission, an account) is the only mid-day page.",
    },
  ],
  watchdogPolicy:
    "Respawn at: $3 with no commits · same failure ×3 · 20 minutes silent. Park at: 3 respawns. Page at: human-only blocker, or an ⚡-flagged item at any milestone. Never: edit code, approve its own respawns past the cap, raise its own limits.",
};
