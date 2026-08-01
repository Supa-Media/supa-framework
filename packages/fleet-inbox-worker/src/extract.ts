/**
 * Turning a transcript into proposed work items, via the Anthropic Messages
 * API.
 *
 * This is extraction, not implementation — the model reads what the owner said
 * and writes down what he asked for. It never decides *how* to build anything,
 * which is why it runs on Sonnet at low effort rather than something
 * expensive: the hard reasoning happens later, in the agent that picks the
 * issue up, and only after a human pressed ✅.
 *
 * Raw `fetch` rather than `@anthropic-ai/sdk` — this package is dependency-free
 * so it can live in the framework monorepo without touching the lockfile, and
 * one POST is not worth an SDK. The request shape is pinned to the current API
 * and the notable constraints are called out inline; if you change the model,
 * re-check them.
 */

import { FLEET_APPS, UNASSIGNED } from "./fleet";
import { extractJsonBlock } from "./validate";
import type { Env } from "./env";
import type { Initiative } from "./github";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/**
 * Sonnet-class, because this is structured extraction over a paragraph of
 * speech. Do not "upgrade" this to an Opus model without a reason — the cost
 * would rise and the output wouldn't.
 */
export const EXTRACTION_MODEL = "claude-sonnet-5";

const APP_KEYS = [...FLEET_APPS.map((app) => app.key), UNASSIGNED];

/**
 * The response schema, enforced server-side via `output_config.format`.
 *
 * Structured outputs require `additionalProperties: false` on every object and
 * every property listed in `required` — there is no "optional field". So
 * `initiative` and `new_initiative` are both always present and the unused one
 * is `""`; `validate.ts` collapses that pair back into a single value plus an
 * `is_new_initiative` flag.
 */
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "plan_edits"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "acceptance_criteria",
          "app",
          "initiative",
          "new_initiative",
          "size",
          "source_quote",
        ],
        properties: {
          title: { type: "string", description: "Imperative one-liner naming the work." },
          acceptance_criteria: {
            type: "array",
            items: { type: "string" },
            description: "What must be true for this to be done. Empty if unstated.",
          },
          app: { type: "string", enum: APP_KEYS },
          initiative: {
            type: "string",
            description: "An EXISTING initiative name for the routed app, or \"\".",
          },
          new_initiative: {
            type: "string",
            description: "A proposed NEW initiative name, or \"\". Never set both.",
          },
          size: { type: "string", enum: ["s", "m", "l"] },
          source_quote: {
            type: "string",
            description: "Verbatim span of the source this item came from.",
          },
        },
      },
    },
    plan_edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "target", "app", "reason"],
        properties: {
          type: { type: "string", enum: ["reprioritize", "cancel", "modify"] },
          target: { type: "string", description: "Initiative, issue, or plan being changed." },
          app: { type: "string", enum: APP_KEYS },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export interface FleetContext {
  appKey: string;
  label: string;
  slug: string;
  initiatives: Initiative[];
}

export function buildSystemPrompt(
  context: readonly FleetContext[],
  learnings: string,
): string {
  const apps = context
    .map((app) => {
      const initiatives =
        app.initiatives.length === 0
          ? "  (no initiatives declared yet)"
          : app.initiatives
              .map((i) => `  - ${i.name}${i.description === undefined ? "" : ` — ${i.description}`}`)
              .join("\n");
      const vocabulary = FLEET_APPS.find((a) => a.key === app.appKey)?.vocabulary ?? [];
      return [
        `### ${app.label} (app: \`${app.appKey}\`, repo: ${app.slug})`,
        `Domain vocabulary: ${vocabulary.join(", ")}`,
        "Initiatives:",
        initiatives,
      ].join("\n");
    })
    .join("\n\n");

  const sections = [
    "You read a transcript of one person thinking out loud about his software fleet, and write down what he asked for. You do not design, plan, or implement anything.",
    "",
    "## The fleet",
    "",
    apps,
    "",
    "## Rules",
    "",
    [
      "- One item per distinct piece of work. Do not merge two asks into one item, and do not split one ask into steps — steps are the implementer's job.",
      "- `title` is an imperative one-liner. No preamble, no \"we should\".",
      "- `acceptance_criteria` records only what he actually said done looks like. Invent nothing; an empty list is correct when he didn't say.",
      `- Route to the app whose domain vocabulary matches. When two apps fit equally, or none does, use \`${UNASSIGNED}\` — a wrong repo costs more than an unrouted item.`,
      "- Prefer an existing initiative. Only set `new_initiative` when nothing existing fits.",
      "- `size`: s = under a day, m = a few days, l = more than a week. Guess from scope, not confidence.",
      "- `source_quote` is a verbatim span of the transcript. Never paraphrase it — it is the audit trail.",
      "- `plan_edits` is for changes to work that already exists: deprioritize X, cancel Y, change the approach on Z. New work is an item, not a plan edit.",
      "- Speech is messy. Ignore filler, self-corrections, and asides that aren't asks. If he said nothing actionable, return empty arrays — that is a valid, useful answer.",
    ].join("\n"),
  ];

  if (learnings.trim() !== "") {
    sections.push(
      "",
      "## Previously rejected",
      "",
      "These proposals were rejected by the owner. Do not propose their like again.",
      "",
      learnings.trim(),
    );
  }

  return sections.join("\n");
}

export function buildUserPrompt(transcript: string, sourceKind: string): string {
  return [
    `Source: ${sourceKind}`,
    "",
    "<transcript>",
    transcript,
    "</transcript>",
    "",
    "Extract the work items and plan edits.",
  ].join("\n");
}

export type ExtractionCallResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: string };

interface AnthropicResponse {
  stop_reason?: string;
  stop_details?: { category?: string | null } | null;
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Call the model and hand back the parsed JSON body, unvalidated.
 *
 * Validation lives in `validate.ts` and runs on this output — structured
 * outputs make a conforming response the normal case, not a guaranteed one.
 */
export async function callExtraction(
  env: Env,
  input: { transcript: string; sourceKind: string; context: readonly FleetContext[]; learnings: string },
): Promise<ExtractionCallResult> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      max_tokens: 8000,
      system: buildSystemPrompt(input.context, input.learnings),
      messages: [
        { role: "user", content: buildUserPrompt(input.transcript, input.sourceKind) },
      ],
      // Adaptive thinking at `low` effort, rather than thinking disabled: it is
      // the documented recommendation for this model, and `low` already scopes
      // the spend to the task. Note `temperature`/`top_p` are rejected outright
      // on this model class — steer with the prompt, not with sampling.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return { ok: false, reason: `Anthropic ${response.status}: ${detail.slice(0, 300)}` };
  }

  const payload = (await response.json()) as AnthropicResponse;

  // Safety classifiers can decline a request outright — HTTP 200, empty or
  // partial content. Checking `stop_reason` before reading `content` is the
  // difference between an honest message and a confusing crash.
  if (payload.stop_reason === "refusal") {
    const category = payload.stop_details?.category ?? "unspecified";
    return { ok: false, reason: `The extraction model declined that one (${category}).` };
  }
  if (payload.stop_reason === "max_tokens") {
    return { ok: false, reason: "That was too long to extract in one go — send it in pieces." };
  }

  // With thinking on, `content[0]` is a thinking block, not the answer.
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();

  if (text === "") return { ok: false, reason: "The extraction model returned nothing." };

  try {
    return { ok: true, raw: JSON.parse(text) };
  } catch {
    // Structured outputs make this unlikely, but a fenced or prose-wrapped
    // object is the classic failure and cheap to recover from.
    try {
      return { ok: true, raw: JSON.parse(extractJsonBlock(text)) };
    } catch {
      return { ok: false, reason: "The extraction model returned something that isn't JSON." };
    }
  }
}
