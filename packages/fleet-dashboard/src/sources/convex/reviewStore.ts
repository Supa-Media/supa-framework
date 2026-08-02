/**
 * The review marker's remote half.
 *
 * Deliberately not part of `FleetSource`: the marker is not fleet data, it is
 * *your* data, it is written as well as read, and a source that must never throw
 * is the wrong shape for a write whose failure the caller has to know about.
 *
 * Both methods return an outcome object rather than throwing, for the same
 * reason `LabelBatchOutcome` exists: "the backend has no marker yet" and "the
 * backend could not be reached" are different facts, and the caller resolves
 * them differently — the first means push what we have, the second means keep
 * using localStorage and say so.
 */

import type { BackendConfig } from "../../lib/backend";
import type { ReviewMark } from "../../lib/review";
import { backendFetch } from "./client";

export type MarkOutcome =
  | { ok: true; mark: ReviewMark | null }
  | { ok: false; message: string };

export interface ReviewStore {
  read(signal?: AbortSignal): Promise<MarkOutcome>;
  /** Returns the mark the backend settled on, which may be one it already had. */
  write(mark: ReviewMark): Promise<MarkOutcome>;
}

export function createConvexReviewStore(backend: BackendConfig): ReviewStore {
  return {
    async read(signal?: AbortSignal): Promise<MarkOutcome> {
      try {
        const payload = await backendFetch<unknown>(backend, {
          path: "/fleet/review",
          ...(signal === undefined ? {} : { signal }),
        });
        return { ok: true, mark: parseMark(readField(payload, "state")) };
      } catch (error) {
        return { ok: false, message: describe(error) };
      }
    },

    async write(mark: ReviewMark): Promise<MarkOutcome> {
      try {
        const payload = await backendFetch<unknown>(backend, {
          path: "/fleet/review",
          method: "POST",
          body: mark,
        });
        // The backend answers `{ applied, state }` — `applied: false` means a
        // newer mark was already there, and its state is the one to believe.
        return { ok: true, mark: parseMark(readField(payload, "state")) };
      } catch (error) {
        return { ok: false, message: describe(error) };
      }
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readField(payload: unknown, key: string): unknown {
  if (typeof payload !== "object" || payload === null) return null;
  return (payload as Record<string, unknown>)[key];
}

/** Total parse: an unrecognizable mark is `null`, i.e. "the backend has none". */
export function parseMark(raw: unknown): ReviewMark | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const lastReviewedAt = record.lastReviewedAt;
  if (typeof lastReviewedAt !== "string" || Number.isNaN(new Date(lastReviewedAt).getTime())) {
    return null;
  }
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : new Date(lastReviewedAt).getTime();
  return {
    lastReviewedAt,
    updatedAt,
    device: typeof record.device === "string" && record.device !== "" ? record.device : "unknown",
  };
}
