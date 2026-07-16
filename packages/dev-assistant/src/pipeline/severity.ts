/**
 * Auto-merge severity cap (ADR-029 Phase 3). Per-user cap on the contribution
 * risk level that may auto-merge, keyed off a bug's originator: an item
 * auto-merges only when its `riskLevel` is at or below this cap.
 *
 * Ported verbatim from Togather's `devAssistant/maintainers.ts` — PURE so the
 * gate is testable without a ctx.
 */

export const AUTO_MERGE_SEVERITIES = ["none", "low", "medium", "high"] as const;
export type AutoMergeSeverity = (typeof AUTO_MERGE_SEVERITIES)[number];

/**
 * Ordinal rank for the severity gate. A contribution auto-merges only when its
 * riskLevel rank is <= the originator's cap rank. "none" (-1) sits below every
 * real risk level, so those contributions never auto-merge.
 */
export const AUTO_MERGE_SEVERITY_ORDER: Record<AutoMergeSeverity, number> = {
  none: -1,
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Default cap for a user without an explicit setting. "low" preserves the
 * original global policy (only low-risk contributions auto-merge). Overridable
 * per package via `DevAssistantConfig.defaultAutoMergeMaxSeverity`.
 */
export const DEFAULT_AUTO_MERGE_MAX_SEVERITY: AutoMergeSeverity = "low";

/**
 * Whether a contribution of `riskLevel` may auto-merge under `cap`. A missing
 * riskLevel never auto-merges (there is nothing to compare against the cap).
 */
export function isWithinAutoMergeCap(
  riskLevel: "low" | "medium" | "high" | undefined,
  cap: AutoMergeSeverity,
): boolean {
  if (riskLevel === undefined) return false;
  return AUTO_MERGE_SEVERITY_ORDER[riskLevel] <= AUTO_MERGE_SEVERITY_ORDER[cap];
}
