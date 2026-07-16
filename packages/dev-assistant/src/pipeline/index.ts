/**
 * Pure pipeline core for `@supa-media/dev-assistant` — the status machine,
 * per-run-mode callback policy, auto-merge severity gate, HMAC signature
 * verification, GitHub REST helpers, and plain-language copy. No Convex, no ctx:
 * everything here is unit-testable in isolation and shared by the Convex
 * function factories.
 */
export * from "./statusMachine";
export * from "./callbackPolicy";
export * from "./severity";
export * from "./signature";
export * from "./text";
export * from "./github";
