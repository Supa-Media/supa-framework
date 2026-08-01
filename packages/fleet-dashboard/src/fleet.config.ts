/**
 * The fleet: which repos this dashboard watches, how to recognize a deploy, and
 * where each repo keeps the files the dashboard reads.
 *
 * Everything here is public information (repo slugs, workflow filenames, file
 * paths). The GitHub token is NOT here — it is entered in the UI at runtime and
 * kept in localStorage. See README.md.
 */

export interface RepoConfig {
  /** `owner/name` exactly as GitHub spells it. */
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
   * Workflow filename to `workflow_dispatch` from the Secrets view's "run sync"
   * button, and the `environment` input values it accepts. events-os names this
   * `sync-github-secrets.yml`; everyone else `sync-secrets.yml`.
   */
  secretsSyncWorkflow: string | null;
  secretsSyncEnvironments: string[];
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
   * `https://t.me/<bot>` — the 🎙 course-correct button on Review. The bot is a
   * separate workstream (the Telegram worker that files `inbox:proposed`
   * issues); the dashboard only ever deep-links to it.
   */
  telegramUrl: string;
  /** Where the ⌘K palette's "open Claude Code" action points. */
  claudeCodeUrl: string;
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
  telegramUrl: "https://t.me/SupaFleetBot",
  claudeCodeUrl: "https://claude.ai/code",
  repos: [
    {
      slug: "togathernyc/togather",
      label: "Togather",
      // "Deploy to Production" + "Deploy Convex"
      deployWorkflows: ["deploy-to-production.yml", "deploy-convex.yml"],
      productionWorkflow: "deploy-to-production.yml",
      secretsAllowlistPath: "ee/secrets-allowlist.json",
      secretsSyncWorkflow: "sync-secrets.yml",
      secretsSyncEnvironments: ["staging", "production"],
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
