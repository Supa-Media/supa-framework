/**
 * HTTP route registrar for the dev-assistant callback / upload / GitHub webhook.
 * Ported from Togather's `apps/convex/http.ts`. The consumer calls the returned
 * `registerRoutes(http)` from their own `http.ts` after building their router.
 *
 * The HMAC header name is configurable (`cfg.signatureHeader`, default
 * `x-supa-signature`); Togather keeps `x-togather-signature`.
 */

import { httpActionGeneric, type HttpRouter } from "convex/server";
import type { ResolvedDevAssistantConfig } from "../config";
import type { DevAssistantRefs } from "./refs";
import {
  verifyCallbackSignature,
  verifyGithubSignature,
} from "../pipeline/signature";
import { BUG_STATUSES, RISK_LEVELS, SCOPES, REVIEW_VERDICTS } from "../pipeline/statusMachine";

// Statuses a Routine callback may report (spec/impl/review/fix + merged/rejected).
const CALLBACK_STATUSES = BUG_STATUSES.filter((s) => s !== "DRAFT" && s !== "READY_FOR_IMPL");
const UPLOAD_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export function makeHttpRegistrar(
  cfg: ResolvedDevAssistantConfig,
  refs: DevAssistantRefs,
) {
  const header = cfg.signatureHeader;

  return function registerRoutes(http: HttpRouter): void {
    // ---- POST /dev-assistant/callback ----
    http.route({
      path: "/dev-assistant/callback",
      method: "POST",
      handler: httpActionGeneric(async (ctx: any, request: Request) => {
        const body = await request.text();
        const signature = request.headers.get(header);
        if (!signature) {
          return new Response(`Missing ${header} header`, { status: 401 });
        }
        const secret = process.env.DEV_ASSISTANT_CALLBACK_SECRET;
        if (!secret) {
          console.error("[DevAssistant] DEV_ASSISTANT_CALLBACK_SECRET not configured");
          return new Response("Callback not configured", { status: 500 });
        }
        if (!(await verifyCallbackSignature(body, signature, secret))) {
          console.error("[DevAssistant] Invalid callback signature");
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const {
          bugId,
          routineRunId,
          status,
          prUrl,
          screenshots,
          message,
          spec,
          riskLevel,
          aiTitle,
          area,
          scope,
          splitSlices,
          verifyOnStaging,
          reviewVerdict,
          reviewSummary,
        } = payload;

        if (!bugId || !routineRunId || !status) {
          return new Response("Missing bugId, routineRunId, or status", { status: 400 });
        }
        if (!CALLBACK_STATUSES.includes(status)) {
          return new Response(`Unsupported status: ${status}`, { status: 400 });
        }
        if (spec !== undefined && typeof spec !== "string") {
          return new Response("Invalid spec: must be a string", { status: 400 });
        }
        if (riskLevel !== undefined && !RISK_LEVELS.includes(riskLevel)) {
          return new Response(`Unsupported riskLevel: ${riskLevel}`, { status: 400 });
        }
        if (aiTitle !== undefined && typeof aiTitle !== "string") {
          return new Response("Invalid aiTitle: must be a string", { status: 400 });
        }
        if (area !== undefined && typeof area !== "string") {
          return new Response("Invalid area: must be a string", { status: 400 });
        }
        if (scope !== undefined && !SCOPES.includes(scope)) {
          return new Response(`Unsupported scope: ${scope}`, { status: 400 });
        }
        let validatedSplitSlices: { title: string; prompt: string }[] | undefined;
        if (splitSlices !== undefined) {
          if (
            !Array.isArray(splitSlices) ||
            !splitSlices.every(
              (s: any) =>
                s &&
                typeof s === "object" &&
                typeof s.title === "string" &&
                typeof s.prompt === "string",
            )
          ) {
            return new Response(
              "Invalid splitSlices: must be an array of { title, prompt } strings",
              { status: 400 },
            );
          }
          validatedSplitSlices = splitSlices.map((s: any) => ({
            title: s.title,
            prompt: s.prompt,
          }));
        }
        if (verifyOnStaging !== undefined && typeof verifyOnStaging !== "boolean") {
          return new Response("Invalid verifyOnStaging: must be a boolean", { status: 400 });
        }
        if (
          reviewVerdict !== undefined &&
          !REVIEW_VERDICTS.includes(reviewVerdict)
        ) {
          return new Response(`Unsupported reviewVerdict: ${reviewVerdict}`, { status: 400 });
        }
        if (reviewSummary !== undefined && typeof reviewSummary !== "string") {
          return new Response("Invalid reviewSummary: must be a string", { status: 400 });
        }
        // Screenshots must be fetchable http(s) URLs (a data: URI renders blank).
        if (
          screenshots !== undefined &&
          (!Array.isArray(screenshots) ||
            !screenshots.every(
              (s: any) => typeof s === "string" && /^https?:\/\//.test(s),
            ))
        ) {
          return new Response(
            "Invalid screenshots: must be an array of http(s) URLs",
            { status: 400 },
          );
        }

        await ctx.scheduler.runAfter(0, refs.actions.handleRoutineCallback, {
          bugId,
          routineRunId,
          status,
          prUrl,
          screenshots,
          message,
          spec,
          riskLevel,
          aiTitle,
          area,
          scope,
          splitSlices: validatedSplitSlices,
          verifyOnStaging,
          reviewVerdict,
          reviewSummary,
        });

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    });

    // ---- POST /dev-assistant/upload ----
    http.route({
      path: "/dev-assistant/upload",
      method: "POST",
      handler: httpActionGeneric(async (ctx: any, request: Request) => {
        const body = await request.text();
        const signature = request.headers.get(header);
        if (!signature) {
          return new Response(`Missing ${header} header`, { status: 401 });
        }
        const secret = process.env.DEV_ASSISTANT_CALLBACK_SECRET;
        if (!secret) {
          console.error("[DevAssistant] DEV_ASSISTANT_CALLBACK_SECRET not configured");
          return new Response("Upload not configured", { status: 500 });
        }
        if (!(await verifyCallbackSignature(body, signature, secret))) {
          console.error("[DevAssistant] Invalid upload signature");
          return new Response("Invalid signature", { status: 401 });
        }
        if (!cfg.uploadImage) {
          // No upload resolver configured — the Routine falls back to inline mocks.
          return new Response("Upload not supported", { status: 501 });
        }

        let payload: {
          dataBase64?: string;
          contentType?: string;
          fileName?: string;
        };
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const contentType = payload.contentType ?? "image/png";
        if (!UPLOAD_CONTENT_TYPES.includes(contentType)) {
          return new Response(`Unsupported contentType: ${contentType}`, { status: 400 });
        }
        if (typeof payload.dataBase64 !== "string" || payload.dataBase64.length === 0) {
          return new Response("Missing dataBase64", { status: 400 });
        }

        // Tolerate a full `data:<type>;base64,<data>` URI by taking the tail.
        const base64 = payload.dataBase64.includes(",")
          ? payload.dataBase64.slice(payload.dataBase64.indexOf(",") + 1)
          : payload.dataBase64;
        let byteLength: number;
        try {
          byteLength = atob(base64).length;
        } catch {
          return new Response("Invalid base64", { status: 400 });
        }
        if (byteLength === 0) return new Response("Empty image", { status: 400 });
        if (byteLength > UPLOAD_MAX_BYTES) {
          return new Response("Image too large", { status: 413 });
        }

        try {
          const { url } = await cfg.uploadImage(ctx, {
            dataBase64: base64,
            contentType,
            fileName: payload.fileName ?? "mock.png",
          });
          return new Response(JSON.stringify({ url }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("[DevAssistant] upload handler threw:", error);
          return new Response("Upload failed", { status: 500 });
        }
      }),
    });

    // ---- POST /github/webhook ----
    http.route({
      path: "/github/webhook",
      method: "POST",
      handler: httpActionGeneric(async (ctx: any, request: Request) => {
        const body = await request.text();
        // GH_WEBHOOK_SECRET, falling back to the callback secret (single shared
        // secret serves both channels). GH_* not GITHUB_* — GitHub reserves the
        // GITHUB_ secret-name prefix.
        const secret =
          process.env.GH_WEBHOOK_SECRET ??
          process.env.DEV_ASSISTANT_CALLBACK_SECRET;
        if (!secret) {
          console.error("[GithubWebhook] GH_WEBHOOK_SECRET not configured");
          return new Response("GitHub webhook not configured", { status: 503 });
        }
        const signature = request.headers.get("x-hub-signature-256");
        if (!signature) {
          return new Response("Missing x-hub-signature-256 header", { status: 401 });
        }
        if (!(await verifyGithubSignature(body, signature, secret))) {
          console.error("[GithubWebhook] Invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        const event = request.headers.get("x-github-event");
        if (event !== "pull_request" && event !== "workflow_run") {
          return new Response("ignored", { status: 200 });
        }

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        if (event === "workflow_run") {
          const run = payload.workflow_run;
          if (
            !payload.action ||
            !run ||
            typeof run.name !== "string" ||
            typeof run.head_sha !== "string"
          ) {
            return new Response("ignored", { status: 200 });
          }
          await ctx.scheduler.runAfter(0, refs.bugs.handleWorkflowRunEvent, {
            action: payload.action,
            name: run.name,
            status: typeof run.status === "string" ? run.status : undefined,
            conclusion: typeof run.conclusion === "string" ? run.conclusion : undefined,
            headSha: run.head_sha,
            headBranch: typeof run.head_branch === "string" ? run.head_branch : undefined,
            runStartedAt:
              typeof run.run_started_at === "string" &&
              !Number.isNaN(Date.parse(run.run_started_at))
                ? Date.parse(run.run_started_at)
                : undefined,
          });
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // pull_request: only closed PRs matter.
        if (payload.action !== "closed") {
          return new Response("ignored", { status: 200 });
        }
        const pr = payload.pull_request;
        const branchRef = pr?.head?.ref;
        if (!pr || typeof pr.merged !== "boolean" || typeof branchRef !== "string") {
          return new Response("Invalid pull_request payload", { status: 400 });
        }
        await ctx.scheduler.runAfter(0, refs.bugs.handleGithubPrClosed, {
          branchRef,
          prUrl: typeof pr.html_url === "string" ? pr.html_url : undefined,
          merged: pr.merged,
          mergeCommitSha:
            typeof pr.merge_commit_sha === "string" ? pr.merge_commit_sha : undefined,
        });
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    });
  };
}
