/** Types for `@supa-media/apple-targets`. Hand-written; the runtime is CommonJS. */

export const APP_GROUPS_KEY: "com.apple.security.application-groups";
export const PLUGIN: "@bacons/apple-targets";

/* ── app.config helpers ────────────────────────────────────────────────── */

/** `group.<bundleIdentifier>` — the one name the app and its targets share. */
export function appGroupIdentifier(bundleIdentifier: string): string;

export interface AppleTargetsOptions {
  /** Must start with `group.` and follow reverse-DNS. */
  appGroup: string;
  /** Defaults to `process.env.APPLE_TEAM_ID`. Throws if neither is set. */
  appleTeamId?: string;
  /** e.g. `["audio"]` when the phone keeps capturing in the background. */
  backgroundModes?: readonly string[];
  /** Set false to manage the `plugins` array yourself. */
  plugin?: boolean;
  infoPlist?: Record<string, unknown>;
  entitlements?: Record<string, unknown>;
}

/** Returns a new config; never mutates, and is safe to apply twice. */
export function withAppleTargets<T extends Record<string, any>>(
  config: T,
  options: AppleTargetsOptions,
): T;

/* ── expo-target.config.js ─────────────────────────────────────────────── */

export interface AppleTargetOptions {
  appGroup: string;
  name?: string;
  displayName?: string;
  /** Relative (`".watch"`) or absolute. */
  bundleIdentifier?: string;
  deploymentTarget?: string;
  icon?: string;
  colors?: Record<string, string>;
  images?: Record<string, string>;
  frameworks?: readonly string[];
  entitlements?: Record<string, unknown>;
}

export interface AppleTargetConfig extends Record<string, unknown> {
  type: string;
  entitlements: Record<string, unknown>;
}

export function defineWatchTarget(options: AppleTargetOptions): AppleTargetConfig;
export function defineWidgetTarget(options: AppleTargetOptions): AppleTargetConfig;
export function defineWatchWidgetTarget(options: AppleTargetOptions): AppleTargetConfig;
export function renderTargetConfig(target: AppleTargetConfig, note?: string): string;

/* ── the phone↔watch transport ─────────────────────────────────────────── */

export type WatchTransport = "sendMessage" | "updateApplicationContext" | "transferUserInfo";

export const TRANSPORTS: Readonly<{
  live: "sendMessage";
  queued: "transferUserInfo";
  snapshot: "updateApplicationContext";
}>;

export interface WatchSnapshot {
  /** Session time, not wall-clock time. */
  elapsedMs?: number;
  /** The watch's clock when this snapshot arrived. */
  receivedAt?: number;
  running?: boolean;
}

export interface WatchBridge {
  transportFor(kind: string): WatchTransport;
  deliverable(
    kind: string,
    link: { reachable: boolean },
  ): { ok: true; transport: WatchTransport } | { ok: false; why: "unreachable" };
  /** Stamps a queued command at the moment of the press, never on arrival. */
  stampCommand(
    kind: string,
    input: { state: WatchSnapshot | null; now: number },
  ): { kind: string; atMs: number; pressedAt: number };
  presentState(
    state: WatchSnapshot | null,
    link: { now: number; reachable?: boolean },
  ): {
    hasSession: boolean;
    live: boolean;
    stale: boolean;
    ageMs?: number | null;
    elapsedMs: number;
    controlsEnabled: boolean;
  };
  live: string[];
  queued: string[];
  stalenessMs: number;
}

export function defineWatchBridge(definition: {
  /** Commands that are wrong when they arrive late. Never queued. */
  liveCommands: readonly string[];
  /** Commands that are still true when they arrive late. FIFO-queued. */
  queuedCommands?: readonly string[];
  stalenessMs?: number;
}): WatchBridge;
