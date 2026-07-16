/**
 * Configuration surface for `createDevAssistant`. Only the app-specific parts of
 * Togather's devAssistant are exposed here — the role gate, the notifier, the
 * media/upload resolvers, the repo/GitHub config, and a few tunables. Env var
 * names are kept identical to Togather where they are already generic
 * (`CLAUDE_ROUTINES_TRIGGER_URL[_SPEC|_IMPL|_REVIEW]`, `..._TOKEN...`,
 * `DEV_ASSISTANT_CALLBACK_SECRET`, `AUTO_MERGE_ENABLED`, `AUTO_MERGE_METHOD`,
 * `GH_MIRROR_TOKEN`/`GITHUB_MIRROR_TOKEN`, `GH_WEBHOOK_SECRET`,
 * `CONVEX_SITE_URL`).
 */

import type { RepoConfig } from "./pipeline/github";
import type { AutoMergeSeverity } from "./pipeline/severity";
import { DEFAULT_AUTO_MERGE_MAX_SEVERITY } from "./pipeline/severity";
import {
  DEFAULT_MAX_FIX_ROUNDS,
  DEFAULT_PRODUCTION_RETRIGGER_COOLDOWN_MS,
} from "./pipeline/text";
import type { DevAssistantNotifier } from "./notifier";
import { noopNotifier } from "./notifier";

/** Minimal DB/auth ctx passed to the role gate (kept structural, no _generated). */
export interface RoleGateCtx {
  db: { get: (id: any) => Promise<any> };
  [key: string]: unknown;
}

/** Ctx passed to the optional upload handler for POST /dev-assistant/upload. */
export interface UploadCtx {
  [key: string]: unknown;
}

export interface UploadArgs {
  dataBase64: string;
  contentType: string;
  fileName: string;
}

export interface DevAssistantConfig {
  /**
   * Module-path prefix (relative to the consumer's convex functions root) where
   * this package's functions are re-exported, WITHOUT a trailing slash — e.g.
   * "functions/devAssistant". Used to build internal function references for the
   * event-driven scheduling (READY_FOR_IMPL → dispatchBug, etc.). The consumer
   * MUST re-export the returned functions at exactly:
   *   `${functionsPath}/bugs`, `${functionsPath}/actions`,
   *   `${functionsPath}/contributions`, `${functionsPath}/maintainers`.
   */
  functionsPath: string;

  /**
   * Resolve a client-supplied auth `token` to the calling user's id, throwing a
   * `ConvexError` when it's invalid. App-specific (Convex Auth token schemes
   * vary), so it's a seam. In Togather this is `requireAuth(ctx, token)`.
   */
  authenticate: (ctx: RoleGateCtx, token: string) => Promise<string> | string;

  /**
   * Role gate (the primary seam). Return true if `userId` may use the dev
   * assistant / contributor dashboard. In Togather this checks
   * `users.platformRoles` for `dev_maintainer` (plus staff/superuser).
   */
  canUseDevAssistant: (
    ctx: RoleGateCtx,
    userId: string,
  ) => Promise<boolean> | boolean;

  /**
   * More privileged gate for the maintainer review-screen ops (reject / mark
   * merged / retry dispatch / read any bug for review). Defaults to
   * `canUseDevAssistant` (single-tier: contributors == maintainers, per ADR-029
   * decision 1). Togather passes a staff/superuser check here.
   */
  isSuperAdmin?: (
    ctx: RoleGateCtx,
    userId: string,
  ) => Promise<boolean> | boolean;

  /** Repo / GitHub config (owner/name + workflow names + issue footer). */
  repo: RepoConfig;

  /**
   * HMAC callback header name the Routine signs with. Defaults to
   * "x-supa-signature". Togather keeps "x-togather-signature" for backward
   * compatibility. Case-insensitive on read.
   */
  signatureHeader?: string;

  /**
   * Notifier seam — push/chat side effects at pipeline transitions. Defaults to
   * a no-op (a correct, silent pipeline).
   */
  notifier?: DevAssistantNotifier;

  /**
   * Resolve a stored media path (e.g. "r2:chat/…") to a fetchable public URL
   * for the client and the vision-capable Routine. Defaults to passing http(s)
   * URLs through unchanged and dropping everything else.
   */
  resolveMediaUrl?: (url: string) => string | undefined;

  /**
   * Validate an attachment path submitted from the dashboard (throws to reject).
   * Togather requires an "r2:" storage prefix so a caller can't stash an
   * arbitrary external URL (a tracking-beacon / SSRF surface). Defaults to
   * allowing "r2:" paths and http(s) URLs.
   */
  assertValidAttachment?: (url: string) => void;

  /**
   * Publish a Routine-uploaded image (POST /dev-assistant/upload) and return its
   * public URL. When omitted, the upload route responds 501 (the Routine falls
   * back to inline ASCII/markdown mocks). Togather stores to R2.
   */
  uploadImage?: (
    ctx: UploadCtx,
    args: UploadArgs,
  ) => Promise<{ url: string }>;

  /** Allowed area tags for triage (informational; used in the spec prompt). */
  areas?: string[];

  /** Fix-round budget before escalating to a human (default 3). */
  maxFixRounds?: number;

  /** Production re-trigger cooldown in ms (default 15 min). */
  productionRetriggerCooldownMs?: number;

  /** Default per-user auto-merge severity cap when unset (default "low"). */
  defaultAutoMergeMaxSeverity?: AutoMergeSeverity;
}

/** Config with defaults applied. */
export interface ResolvedDevAssistantConfig {
  functionsPath: string;
  authenticate: (ctx: RoleGateCtx, token: string) => Promise<string> | string;
  canUseDevAssistant: (
    ctx: RoleGateCtx,
    userId: string,
  ) => Promise<boolean> | boolean;
  isSuperAdmin: (
    ctx: RoleGateCtx,
    userId: string,
  ) => Promise<boolean> | boolean;
  repo: RepoConfig;
  signatureHeader: string;
  notifier: DevAssistantNotifier;
  resolveMediaUrl: (url: string) => string | undefined;
  assertValidAttachment: (url: string) => void;
  uploadImage?: (ctx: UploadCtx, args: UploadArgs) => Promise<{ url: string }>;
  areas: string[];
  maxFixRounds: number;
  productionRetriggerCooldownMs: number;
  defaultAutoMergeMaxSeverity: AutoMergeSeverity;
}

export const DEFAULT_SIGNATURE_HEADER = "x-supa-signature";
export const DEFAULT_AREAS = ["other"];

const DEFAULT_REPO: Pick<
  RepoConfig,
  | "baseBranch"
  | "branchPrefix"
  | "stagingDeployWorkflowNames"
  | "productionDeployWorkflowName"
  | "productionDeployWorkflowFile"
  | "productionDeployInputs"
> = {
  baseBranch: "main",
  branchPrefix: "claude/devbug-",
  stagingDeployWorkflowNames: [],
  productionDeployWorkflowName: "Deploy to Production",
  productionDeployWorkflowFile: "deploy-to-production.yml",
  productionDeployInputs: { update_mode: "silent" },
};

/** Default media resolver: pass http(s) URLs through, drop everything else. */
function defaultResolveMediaUrl(url: string): string | undefined {
  return /^https?:\/\//.test(url) ? url : undefined;
}

/** Default attachment validator: allow "r2:" storage paths and http(s) URLs. */
function defaultAssertValidAttachment(url: string): void {
  if (!url.startsWith("r2:") && !/^https?:\/\//.test(url)) {
    throw new Error("Attachments must be uploaded images");
  }
}

/**
 * Validate the raw config, throwing a descriptive Error on a problem. Pure —
 * unit-testable. Called by `resolveConfig`.
 */
export function validateConfig(config: DevAssistantConfig): void {
  if (!config || typeof config !== "object") {
    throw new Error("createDevAssistant: config is required");
  }
  if (
    typeof config.functionsPath !== "string" ||
    config.functionsPath.length === 0
  ) {
    throw new Error("createDevAssistant: `functionsPath` is required");
  }
  if (config.functionsPath.endsWith("/")) {
    throw new Error(
      "createDevAssistant: `functionsPath` must not end with a slash",
    );
  }
  if (typeof config.authenticate !== "function") {
    throw new Error("createDevAssistant: `authenticate` callback is required");
  }
  if (typeof config.canUseDevAssistant !== "function") {
    throw new Error(
      "createDevAssistant: `canUseDevAssistant` callback is required",
    );
  }
  if (!config.repo || typeof config.repo !== "object") {
    throw new Error("createDevAssistant: `repo` config is required");
  }
  if (!config.repo.owner || !config.repo.name) {
    throw new Error(
      "createDevAssistant: `repo.owner` and `repo.name` are required",
    );
  }
  if (
    config.maxFixRounds !== undefined &&
    (!Number.isInteger(config.maxFixRounds) || config.maxFixRounds < 1)
  ) {
    throw new Error("createDevAssistant: `maxFixRounds` must be a positive integer");
  }
}

/** Apply defaults to a validated config. */
export function resolveConfig(
  config: DevAssistantConfig,
): ResolvedDevAssistantConfig {
  validateConfig(config);
  return {
    functionsPath: config.functionsPath,
    authenticate: config.authenticate,
    canUseDevAssistant: config.canUseDevAssistant,
    isSuperAdmin: config.isSuperAdmin ?? config.canUseDevAssistant,
    repo: { ...DEFAULT_REPO, ...config.repo },
    signatureHeader: (
      config.signatureHeader ?? DEFAULT_SIGNATURE_HEADER
    ).toLowerCase(),
    notifier: config.notifier ?? noopNotifier,
    resolveMediaUrl: config.resolveMediaUrl ?? defaultResolveMediaUrl,
    assertValidAttachment:
      config.assertValidAttachment ?? defaultAssertValidAttachment,
    uploadImage: config.uploadImage,
    areas: config.areas ?? DEFAULT_AREAS,
    maxFixRounds: config.maxFixRounds ?? DEFAULT_MAX_FIX_ROUNDS,
    productionRetriggerCooldownMs:
      config.productionRetriggerCooldownMs ??
      DEFAULT_PRODUCTION_RETRIGGER_COOLDOWN_MS,
    defaultAutoMergeMaxSeverity:
      config.defaultAutoMergeMaxSeverity ?? DEFAULT_AUTO_MERGE_MAX_SEVERITY,
  };
}
