import { Group, Pill, Row, Rows, ViewHeader } from "../components/ui";
import type { Ctx } from "./context";

/**
 * ＋ New app — a checklist, not a wizard.
 *
 * Every step here is real and every link goes somewhere. What is missing is the
 * automation: a button that scaffolds the repo, provisions the vault, and opens
 * the Terraform PR. That is post-v2, and the honest interim is a list that says
 * which steps a human still does and roughly how long Apple will take.
 */

const STEPS: Array<{ tone: "g" | "y" | "p"; who: string; what: string; detail: string }> = [
  {
    tone: "y",
    who: "you",
    what: "Scaffold the repo with create-supa-app",
    detail:
      "Brings framework CI, deploy workflows, and the agent config with it. Nothing here does this for you yet.",
  },
  {
    tone: "y",
    who: "you",
    what: "1Password vault + allowlist + sync wiring",
    detail:
      "A new column in the secrets matrix. The allowlist path is per-repo — add it to fleet.config.ts so this dashboard can see it.",
  },
  {
    tone: "p",
    who: "PR",
    what: "DNS via Terraform",
    detail: "Opened as a pull request against the infra directory; you merge it.",
  },
  {
    tone: "y",
    who: "you",
    what: "Convex staging + production deployments",
    detail: "Two deployments, and the deploy key into the allowlist as CONVEX_DEPLOY_KEY.",
  },
  {
    tone: "y",
    who: "you",
    what: "EAS init with your Expo token",
    detail: "EXPO_TOKEN and EAS_PROJECT_ID go into the allowlist.",
  },
  {
    tone: "p",
    who: "~20 min",
    what: "App Store Connect + Play Console listings",
    detail: "The long pole, and entirely Apple's and Google's. Prep the assets before you start.",
  },
  {
    tone: "y",
    who: "you",
    what: "Register with the fleet",
    detail:
      "One entry in fleet.config.ts: slug, label, deploy workflows, allowlist path, sync workflow. The card, gardener discovery, and review inclusion follow from it.",
  },
];

export function NewApp({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <ViewHeader title="New app" sub="the steps, honestly — the wizard is not built" />

      <p className="lead">
        Nothing on this page is automated yet. It is the checklist the wizard will eventually run,
        written down so the order is not rediscovered each time.
      </p>

      <Rows>
        <Group right={`${STEPS.length} steps`}>from empty to first staging deploy</Group>
        {STEPS.map((step) => (
          <Row key={step.what}>
            <Pill tone={step.tone}>{step.who}</Pill>
            <span className="grow">
              {step.what}
              <span className="sm">{step.detail}</span>
            </span>
          </Row>
        ))}
      </Rows>

      <Rows>
        <Group>links</Group>
        {ctx.config.newAppLinks.map((link) => (
          <Row key={link.url}>
            <span className="grow">
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
              <span className="sm mono">{link.url}</span>
            </span>
          </Row>
        ))}
      </Rows>
    </>
  );
}
