/**
 * Everything the server has not acknowledged yet.
 *
 * A desktop app runs on aeroplanes, in basements, and on hotel wifi that
 * resolves DNS and nothing else. So it never *sends* — it queues, and a drain
 * sends (`./drain.js`). The queue is a pure reducer rather than something
 * living inside an event handler, because the interesting cases are a write
 * that lands before its predecessor, work finished in a tunnel, and a quit
 * mid-drain, and none of those can be reached from a click.
 *
 * ## The rules this file exists to hold
 *
 * **Nothing is ever dropped to save space.** A queued entry can be the only
 * copy of something a person made. It leaves this queue by being acknowledged
 * or by a person deleting the thing it belongs to. No cap, no LRU, no "compact
 * the oldest".
 *
 * **One entry per subject per kind, and the newest content wins.** Typing for
 * an hour is one write, not four thousand. Kinds that genuinely accumulate say
 * so by declaring a `merge`, which is how a transcript, a log or an append-only
 * list stays complete instead of being overwritten by its own last page.
 *
 * **A subject's entries drain in declared order.** Only the head entry of a
 * subject is ever in flight, so a "finish" cannot overtake the content it is
 * finishing — a real failure, because a server that writes on finish would
 * write half a document and then answer every later attempt with the thing it
 * already wrote. Different subjects never block each other.
 *
 * **A refusal that retrying cannot fix parks the entry rather than deleting
 * it.** Parking means a person has to do something — reconnect, re-grant, send
 * a bug report. The content stays queued either way, and a parked head blocks
 * its own subject and nothing else.
 *
 * ## Vocabulary
 *
 * A **subject** is the thing writes are about: one recording, one document, one
 * upload. A **kind** is which write about it — the declared order is the order
 * a server needs them in.
 *
 * @example
 * ```js
 * const outbox = defineOutbox({
 *   kinds: ["create", "chunks", "notes", "finish"],
 *   merge: { chunks: mergeById("id", (a, b) => a.startMs - b.startMs) },
 * });
 *
 * let queue = outbox.empty();
 * queue = outbox.queue(queue, { subjectId, kind: "create", body, now: Date.now() });
 * ```
 */

export const OUTBOX_VERSION = 1;

/**
 * A merger for kinds whose content accumulates rather than replaces.
 *
 * Keyed on a stable id, later wins, optionally sorted. This is what makes a
 * re-send idempotent on the client's side as well as the server's: an entry
 * replayed after a reconnect carries the same ids and collapses instead of
 * duplicating. The ids must therefore be derived from the content's position,
 * never minted per attempt.
 *
 * @param {string} [key] the field holding the stable id
 * @param {string} [field] the body field holding the list
 * @param {(a: any, b: any) => number} [sort]
 */
export function mergeById(key = "id", field = "items", sort) {
  return (existingBody, incomingBody) => {
    const byId = new Map();
    for (const item of Array.isArray(existingBody?.[field]) ? existingBody[field] : []) byId.set(item?.[key], item);
    for (const item of Array.isArray(incomingBody?.[field]) ? incomingBody[field] : []) byId.set(item?.[key], item);
    const merged = [...byId.values()];
    if (sort) merged.sort(sort);
    return { ...existingBody, ...incomingBody, [field]: merged };
  };
}

/** How long to wait after `attempts` failures. Capped, so a queue never stalls. */
export function backoffMs(attempts, jitter = 0) {
  const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (1 + jitter));
}

/**
 * Build a queue over one set of kinds.
 *
 * @param {{ kinds: readonly string[], merge?: Record<string, (existingBody: any, incomingBody: any) => any> }} definition
 */
/** A finite number, or the fallback. `NaN` and `Infinity` are not clocks. */
function number(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function defineOutbox(definition) {
  const kinds = [...definition.kinds];
  if (kinds.length === 0) throw new Error("defineOutbox needs at least one kind");
  if (new Set(kinds).size !== kinds.length) throw new Error("defineOutbox kinds must be unique");
  const mergers = definition.merge ?? {};
  for (const kind of Object.keys(mergers)) {
    if (!kinds.includes(kind)) throw new Error(`defineOutbox has a merge for unknown kind ${JSON.stringify(kind)}`);
  }

  const order = (kind) => kinds.indexOf(kind);
  const entryId = (subjectId, kind) => `${subjectId}:${kind}`;

  function empty() {
    return { version: OUTBOX_VERSION, entries: [] };
  }

  /**
   * Repair whatever was on disk.
   *
   * A queue file that fails to parse is replaced by an empty one — there is
   * nothing else to do with bytes that are not a queue. A file that *parses*
   * keeps every entry it can read, because those are somebody's work; only
   * entries that are structurally unusable, or name a kind this build no longer
   * has an order for, are dropped.
   */
  function normalize(raw) {
    if (typeof raw !== "object" || raw === null) return empty();
    if (raw.version !== OUTBOX_VERSION || !Array.isArray(raw.entries)) return empty();
    const entries = raw.entries
      .filter(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.id === "string" &&
          typeof entry.subjectId === "string" &&
          typeof entry.kind === "string" &&
          kinds.includes(entry.kind) &&
          typeof entry.body === "object" &&
          entry.body !== null,
      )
      // The bookkeeping fields are repaired rather than trusted. A hand-edited
      // or half-written file whose `nextAttemptAt` is a string does not throw —
      // it compares false against every clock, so the entry is silently never
      // offered again and its content sits in the queue forever with nothing to
      // see. Coercing to a number at the boundary turns that into "drains now".
      .map((entry) => ({
        ...entry,
        queuedAt: number(entry.queuedAt, 0),
        updatedAt: number(entry.updatedAt, 0),
        attempts: Math.max(0, number(entry.attempts, 0)),
        state: entry.state === "parked" ? "parked" : "pending",
        nextAttemptAt: number(entry.nextAttemptAt, 0),
      }));
    return { version: OUTBOX_VERSION, entries };
  }

  /**
   * Add or collapse one write.
   *
   * A collapse resets `attempts` and `nextAttemptAt`: the content changed, so
   * the backoff earned by the previous content no longer describes this entry,
   * and a person who just typed something should not wait out a minute of
   * backoff from a write that no longer exists.
   *
   * A **parked** entry is the exception. It stays parked and keeps its backoff,
   * because new content does not make a rejected grant acceptable, and
   * un-parking on every keystroke would hammer a server that has already said
   * no.
   *
   * @param {{ version: number, entries: any[] }} outbox
   * @param {{ subjectId: string, kind: string, body: Record<string, unknown>, now: number }} input
   */
  function queue(outbox, input) {
    if (!kinds.includes(input.kind)) throw new Error(`unknown outbox kind ${JSON.stringify(input.kind)}`);
    const id = entryId(input.subjectId, input.kind);
    const existing = outbox.entries.find((entry) => entry.id === id);

    if (!existing) {
      return {
        ...outbox,
        entries: [
          ...outbox.entries,
          {
            id,
            subjectId: input.subjectId,
            kind: input.kind,
            body: input.body,
            queuedAt: input.now,
            updatedAt: input.now,
            attempts: 0,
            state: "pending",
            nextAttemptAt: input.now,
          },
        ],
      };
    }

    const merger = mergers[input.kind];
    const body = merger ? merger(existing.body, input.body) : { ...input.body };
    const next = {
      ...existing,
      body,
      updatedAt: input.now,
      ...(existing.state === "parked" ? {} : { attempts: 0, nextAttemptAt: input.now, lastError: undefined }),
    };
    return { ...outbox, entries: outbox.entries.map((entry) => (entry.id === id ? next : entry)) };
  }

  /**
   * The next entry to send, or `null`.
   *
   * Head-of-subject only, ordered by kind; among subjects, the one whose head
   * has waited longest, with the id as a tiebreak so the answer is stable.
   *
   * @param {{ entries: any[] }} outbox
   * @param {number} now
   */
  function next(outbox, now) {
    const heads = new Map();
    for (const entry of outbox.entries) {
      const head = heads.get(entry.subjectId);
      if (!head || order(entry.kind) < order(head.kind)) heads.set(entry.subjectId, entry);
    }
    const ready = [...heads.values()]
      .filter((entry) => entry.state === "pending" && entry.nextAttemptAt <= now)
      .sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
    return ready[0] ?? null;
  }

  /**
   * Apply what the server said.
   *
   * The outbox does not know what any error code means — `result.retryable` is
   * the client's judgement (`./client.js`), stated once at the boundary where
   * the status is read, so there is no second table here to disagree with it.
   *
   * @param {{ entries: any[] }} outbox
   * @param {string} id
   * @param {{ ok: true } | { ok: false, code: string, message: string, retryable: boolean }} result
   * @param {number} now
   * @param {number} [jitter]
   */
  function apply(outbox, id, result, now, jitter = 0) {
    return {
      ...outbox,
      entries: outbox.entries.flatMap((entry) => {
        if (entry.id !== id) return [entry];
        if (result.ok) return [];
        const attempts = entry.attempts + 1;
        if (!result.retryable) {
          return [
            {
              ...entry,
              attempts,
              state: "parked",
              parked: { code: result.code, message: result.message, noticedAt: now },
              lastError: result.message,
            },
          ];
        }
        return [{ ...entry, attempts, nextAttemptAt: now + backoffMs(attempts, jitter), lastError: result.message }];
      }),
    };
  }

  /** Every entry for one subject — what "this has not been saved yet" means. */
  function pendingFor(outbox, subjectId) {
    return outbox.entries.filter((entry) => entry.subjectId === subjectId);
  }

  /** How many subjects are waiting. The number a tray tooltip should show. */
  function pendingSubjects(outbox) {
    return new Set(outbox.entries.map((entry) => entry.subjectId)).size;
  }

  /** A person deleted something. The only path that discards queued content. */
  function forget(outbox, subjectId) {
    return { ...outbox, entries: outbox.entries.filter((entry) => entry.subjectId !== subjectId) };
  }

  return { kinds, empty, normalize, queue, next, apply, pendingFor, pendingSubjects, forget };
}
