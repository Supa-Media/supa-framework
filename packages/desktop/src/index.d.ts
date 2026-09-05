/**
 * Types for the Electron-free core of `@supa-media/desktop`.
 *
 * Hand-written rather than emitted, for the same reason the runtime is
 * hand-written JavaScript: this package has to be readable, runnable and
 * testable under plain `node` with nothing installed. A build step between the
 * source and the test is a build step that will one day be the reason the tests
 * did not run.
 */

/* ── settings ──────────────────────────────────────────────────────────── */

export interface SettingsField<T> {
  default: T;
  sticky?: boolean;
  /** Must return the field's safe default when given `undefined`. */
  parse: (value: unknown) => T;
}

export interface SettingsDefinition {
  version: number;
  fields: Record<string, SettingsField<any>>;
}

export interface Settings<T = Record<string, any>> {
  version: number;
  readonly defaults: Readonly<T>;
  /** Repairs anything into a usable record. Never throws. */
  normalize(raw: unknown): T;
  fieldNames: string[];
}

export function defineSettings<T = Record<string, any>>(definition: SettingsDefinition): Settings<T>;
export function boolField(fallback: boolean): SettingsField<boolean>;
export function stringField(fallback?: string | null): SettingsField<string | null>;
export function enumField<V extends string>(values: readonly V[], fallback: V): SettingsField<V>;
export function stringListField(options?: { sticky?: boolean }): SettingsField<string[]>;
export function endpointField(options?: { allowLoopbackHttp?: boolean }): SettingsField<string | null>;
export function acceptableEndpointUrl(
  value: unknown,
  options?: { allowLoopbackHttp?: boolean },
): string | null;

/* ── denylist ──────────────────────────────────────────────────────────── */

export interface DeniableSubject {
  app?: string | null;
  url?: string | null;
}

export function normalizeAppName(name: string): string;
export function isDeniedApp(candidate: string | null | undefined, denylist: readonly string[]): boolean;
export function isDeniedUrl(url: string | null | undefined, denylist: readonly string[]): boolean;
export function isDenied(subject: DeniableSubject, denylist: readonly string[]): boolean;
export function withoutDenied<T>(
  items: readonly T[],
  denylist: readonly string[],
  describe?: (item: T) => DeniableSubject | string,
): T[];

/* ── consent ───────────────────────────────────────────────────────────── */

export type HoldReason =
  | "no-episode"
  | "capture-disabled"
  | "denied"
  | "declined-this-episode"
  | "already-asking"
  | "already-capturing";

export interface ConsentState {
  episode: string | null;
  decision: "asking" | "granted" | "declined" | null;
}

export type ConsentAction =
  | { kind: "ask"; episode: string }
  | { kind: "start"; episode: string }
  | { kind: "hold"; why: HoldReason };

export const IDLE_CONSENT: Readonly<ConsentState>;

export function episodeKey(
  activation:
    | { active: boolean; since: string | number | null; source?: { kind?: string; app?: string | null } | null }
    | null
    | undefined,
): string | null;

export function decideConsent(input: {
  episode: string | null;
  consent: ConsentState;
  denied: boolean;
  captureEnabled: boolean;
  askEveryTime: boolean;
  busy: boolean;
}): ConsentAction;

export function asked(episode: string): ConsentState;
export function answered(episode: string, answer: "granted" | "declined"): ConsentState;
export function forgetEpisode(consent: ConsentState, episode: string | null): ConsentState;

/* ── outbox ────────────────────────────────────────────────────────────── */

export const OUTBOX_VERSION: 1;

export type EntryState = "pending" | "parked";

export interface OutboxEntry {
  /** `${subjectId}:${kind}` — stable, so a collapse can find its predecessor. */
  id: string;
  subjectId: string;
  kind: string;
  body: Record<string, unknown>;
  queuedAt: number;
  updatedAt: number;
  attempts: number;
  state: EntryState;
  /** Earliest millisecond this may be attempted again. */
  nextAttemptAt: number;
  parked?: { code: string; message: string; noticedAt: number };
  lastError?: string;
}

export interface OutboxQueue {
  version: number;
  entries: OutboxEntry[];
}

export type DrainResult =
  | { ok: true }
  | { ok: false; code: string; message: string; retryable: boolean };

export interface Outbox {
  kinds: string[];
  empty(): OutboxQueue;
  normalize(raw: unknown): OutboxQueue;
  queue(
    outbox: OutboxQueue,
    input: { subjectId: string; kind: string; body: Record<string, unknown>; now: number },
  ): OutboxQueue;
  next(outbox: OutboxQueue, now: number): OutboxEntry | null;
  apply(outbox: OutboxQueue, id: string, result: DrainResult, now: number, jitter?: number): OutboxQueue;
  pendingFor(outbox: OutboxQueue, subjectId: string): OutboxEntry[];
  pendingSubjects(outbox: OutboxQueue): number;
  forget(outbox: OutboxQueue, subjectId: string): OutboxQueue;
}

export function defineOutbox(definition: {
  kinds: readonly string[];
  merge?: Record<string, (existingBody: any, incomingBody: any) => any>;
}): Outbox;

export function mergeById(
  key?: string,
  field?: string,
  sort?: (a: any, b: any) => number,
): (existingBody: any, incomingBody: any) => any;

export function backoffMs(attempts: number, jitter?: number): number;

/* ── client + drain ────────────────────────────────────────────────────── */

export const ERROR_CODES: Readonly<{
  invalid: "invalid";
  forbidden: "forbidden";
  conflict: "conflict";
  unavailable: "unavailable";
}>;

export function defaultCodeForStatus(status: number): string;
export function defaultRetryable(code: string): boolean;

export interface GatewayConfig {
  /** Origin plus any fixed path, no trailing slash. See `acceptableEndpointUrl`. */
  baseUrl: string;
  route(entry: Pick<OutboxEntry, "kind" | "subjectId" | "body">): string;
  /** `null` means "this machine is not connected", not "rejected". */
  token(): Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  codeForStatus?: (status: number) => string;
  retryable?: (code: string) => boolean;
}

export function postEntry(config: GatewayConfig, entry: OutboxEntry): Promise<DrainResult>;

export function drainOnce(
  queue: OutboxQueue,
  outbox: Outbox,
  config: GatewayConfig,
  now: () => number,
  maxRequests?: number,
): Promise<{ outbox: OutboxQueue; sent: number; failed: number; parked: number }>;

/* ── token store ───────────────────────────────────────────────────────── */

export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
  /** False when the OS refused encrypted storage. Store nothing rather than fall back. */
  readonly encrypted: boolean;
}

export function memoryTokenStore(initial?: string | null): TokenStore;

/* ── tray + layout ─────────────────────────────────────────────────────── */

export interface TrayPresentation {
  state: string;
  title: string;
  tooltip: string;
  icon: string;
  /** Derived from the state's `capturing` flag, never declared. */
  indicator: boolean;
}

export interface TrayStateDefinition<Input> {
  icon: string;
  /** True for every state in which something privileged is open. */
  capturing?: boolean;
  title?: (input: Input) => string;
  tooltip: (input: Input) => string;
}

export function defineTray<Input extends { state: string } = { state: string } & Record<string, any>>(definition: {
  states: Record<string, TrayStateDefinition<Input>>;
  suffix?: (input: Input) => string;
}): {
  present(input: Input): TrayPresentation;
  states: string[];
  capturingStates: string[];
};

export function formatElapsed(ms: number): string;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function panelPositionUnderTray(input: {
  tray: Rect;
  panel: { width: number; height: number };
  workArea: Rect;
  gap?: number;
  margin?: number;
}): { x: number; y: number; placement: "below" | "above" };

/* ── permissions ───────────────────────────────────────────────────────── */

export type PermissionStatus = "granted" | "denied" | "restricted" | "not-determined" | "unknown";

export interface PermissionBroker {
  status(kind: string): Promise<PermissionStatus>;
  request(kind: string, rationale: string): Promise<PermissionStatus>;
}

export function ensurePermissions(
  broker: PermissionBroker,
  needs: readonly string[],
  rationales?: Record<string, string>,
): Promise<{ ok: boolean; missing: string[]; statuses: Record<string, PermissionStatus> }>;

export function fakePermissionBroker(
  initial?: Record<string, PermissionStatus>,
  onRequest?: Record<string, PermissionStatus>,
): PermissionBroker & { calls: string[] };

/* ── the core/ isolation guard ─────────────────────────────────────────── */

/** `["electron", "@supa-media/desktop/electron"]` — the re-export counts too. */
export const DEFAULT_FORBIDDEN: readonly string[];

export function checkCoreIsolation(config: {
  dirs: string[];
  forbidden?: readonly string[];
  cwd?: string;
}): { ok: boolean; checked: number; violations: { file: string; line: number; specifier: string }[] };
