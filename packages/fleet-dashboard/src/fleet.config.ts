/**
 * The fleet: which repos this dashboard watches, and how to recognize a deploy.
 *
 * Everything here is public information (repo slugs and workflow filenames).
 * The GitHub token is NOT here — it is entered in the UI at runtime and kept in
 * localStorage. See README.md.
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
}

export const fleetConfig: FleetConfig = {
  name: "Supa Fleet",
  owner: "lilseyi",
  costIssueTitle: "[gardeners] weekly cost & activity report",
  gardenerPrefix: "gardener-",
  gardenerSuffix: ".lock.yml",
  repos: [
    {
      slug: "togathernyc/togather",
      label: "Togather",
      // "Deploy to Production" + "Deploy Convex"
      deployWorkflows: ["deploy-to-production.yml", "deploy-convex.yml"],
    },
    {
      slug: "Supa-Media/events-os",
      label: "Events OS",
      // events-os names every deploy workflow "… (production)"
      deployWorkflows: [
        "deploy-convex.yml",
        "deploy-web.yml",
        "deploy-landing.yml",
      ],
    },
    {
      slug: "shyoh/fount-studios",
      label: "Fount Studios",
      // "Deploy to Production" lives at deploy-production.yml here, not
      // deploy-to-production.yml as in togather.
      deployWorkflows: ["deploy-production.yml"],
    },
    {
      slug: "Supa-Media/supa-framework",
      label: "Supa Framework",
      // The framework has no app deploy — shipping it means publishing packages.
      deployWorkflows: ["release.yml"],
    },
  ],
};
