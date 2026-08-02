/**
 * The Convex source: run telemetry, and nothing else.
 *
 * This is the second implementation of `FleetSource` (see the adapter-seam notes
 * at the top of `../types.ts`). It contributes **only** `runEvents` — no
 * projects, no issues, no PRs. That restraint is the whole design: GitHub is the
 * source of truth for work state, and a second source with an opinion about
 * whether an issue is `agent:ready` would be a second answer to a question that
 * already has one.
 *
 * It obeys seam rule 2 absolutely: a dead or misconfigured backend pushes one
 * `SourceError` and returns an otherwise-empty snapshot, so the fleet page keeps
 * rendering GitHub data with a named banner rather than blanking.
 */

import type { BackendConfig } from "../../lib/backend";
import {
  emptySnapshot,
  type FetchOptions,
  type FleetSnapshot,
  type FleetSource,
  type RunEvent,
  type RunEventSource,
} from "../types";
import { backendFetch } from "./client";

/** Matches the backend's own read cap (`convex/runEvents.ts`). */
const MAX_EVENTS = 500;

const SOURCES: readonly RunEventSource[] = ["overnight", "watchdog", "decider", "gardener"];

export const CONVEX_SOURCE_ID = "convex";

export function createConvexSource(backend: BackendConfig): FleetSource {
  return {
    id: CONVEX_SOURCE_ID,
    async fetchFleet(options: FetchOptions): Promise<FleetSnapshot> {
      const snapshot = emptySnapshot();
      snapshot.fetchedAt = new Date().toISOString();
      snapshot.since = options.since;

      try {
        const payload = await backendFetch<unknown>(backend, {
          path: "/fleet/events",
          query: { since: options.since, limit: MAX_EVENTS },
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        snapshot.runEvents = parseEvents(payload);
      } catch (error) {
        // An abort is the dashboard's own doing (a refresh superseded this one)
        // and is not a fact about the backend, so it must not surface as a
        // "partial data" banner naming a service that is fine.
        if (isAbort(error)) return snapshot;
        snapshot.errors.push({
          scope: CONVEX_SOURCE_ID,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return snapshot;
    },
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Total parse. A row that does not make sense is dropped rather than rendered
 * half-blank: this is a status board, and one malformed event posted by a job
 * mid-deploy must not take the panel with it.
 */
export function parseEvents(payload: unknown): RunEvent[] {
  if (typeof payload !== "object" || payload === null) return [];
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const parsed: RunEvent[] = [];
  for (const raw of events) {
    const event = parseEvent(raw);
    if (event !== null) parsed.push(event);
  }
  return parsed.sort((a, b) => b.at.localeCompare(a.at));
}

function parseEvent(raw: unknown): RunEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const { id, source, repo, kind, at } = record;
  if (typeof id !== "string" || id === "") return null;
  if (typeof source !== "string" || !SOURCES.includes(source as RunEventSource)) return null;
  if (typeof repo !== "string" || repo === "") return null;
  if (typeof kind !== "string" || kind === "") return null;
  if (typeof at !== "string" || Number.isNaN(new Date(at).getTime())) return null;

  return {
    id,
    source: source as RunEventSource,
    repoKey: repo.toLowerCase(),
    issueNumber:
      typeof record.issueNumber === "number" && Number.isFinite(record.issueNumber)
        ? record.issueNumber
        : null,
    kind,
    at,
    // Anything that is not an http(s) link is dropped rather than rendered: a
    // `javascript:` value here would become an anchor on the page.
    url: typeof record.url === "string" && /^https?:\/\//.test(record.url) ? record.url : null,
    payload:
      typeof record.payload === "object" && record.payload !== null && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : null,
  };
}
