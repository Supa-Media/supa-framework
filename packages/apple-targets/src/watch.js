"use strict";

/**
 * The phone↔watch contract, as rules rather than as a paragraph in a design doc.
 *
 * The transport is **WatchConnectivity** (`WCSession`), and its three mechanisms
 * have genuinely different delivery semantics. Choosing the wrong one is not a
 * performance mistake, it is a correctness one — so the choice is a function
 * here, tested, rather than a decision each call site makes again:
 *
 * | Mechanism | Semantics | For |
 * | --- | --- | --- |
 * | `sendMessage` | immediate, needs the counterpart reachable, has a reply handler | live commands |
 * | `updateApplicationContext` | latest value only; a newer update replaces an undelivered older one; delivered in the background on reconnect | the state snapshot |
 * | `transferUserInfo` | FIFO queue, guaranteed eventual delivery, background | queued commands |
 *
 * **The snapshot is `updateApplicationContext`, and "only the last update
 * survives" is the semantic we want** rather than a limitation: a stale
 * snapshot with a stale elapsed time is worth nothing next to a fresh one.
 * Push it on every state transition and on a low-frequency tick — never per
 * unit of content. The transport is constrained, and on iOS the same updates
 * count against the Live Activity's own update budget.
 *
 * **A live command is `sendMessage`, and its reply carries the resulting
 * state**, which makes the round trip self-correcting: the wearer presses
 * Pause, the phone's reducer accepts or refuses the transition, and either way
 * the watch renders what the phone now believes rather than what it hoped. A
 * refused command is a UI correction, not an error dialog.
 *
 * ## Out of range: the rule that matters
 *
 * The recording is on the phone, so nothing about the capture is affected. The
 * watch's job is to stop lying.
 *
 * **Live commands are not queued.** A `start` delivered twenty minutes late
 * starts a recording nobody asked for; a late `stop` ends one that already
 * finished. When unreachable, the transport controls are disabled rather than
 * optimistic.
 *
 * **A queued command is one that is still true when it arrives late** — a flag
 * is a timestamp, and a timestamp does not go stale. It goes on
 * `transferUserInfo`, which is FIFO and survives the gap. The critical detail,
 * and the one that is easy to get backwards:
 *
 * > **A queued command's `at` is computed on the watch at the moment of the
 * > press**, from the elapsed time in the last snapshot it holds plus the time
 * > since — and never on arrival at the phone. A flag stamped on delivery
 * > points at the wrong sentence, which is worse than no flag.
 *
 * `stampCommand` is that arithmetic, and it is here so that both sides use the
 * same one.
 *
 * ## What this module is not
 *
 * It is not a native module. There is no verified React Native
 * ↔ WatchConnectivity binding for this framework's Expo configuration yet —
 * see the package README's "not verified" section — so this ships the decision
 * layer and an adapter shape, and the app supplies `send`. When a binding is
 * chosen, it plugs in here without any of these rules moving.
 */

/**
 * @typedef {"sendMessage" | "updateApplicationContext" | "transferUserInfo"} WatchTransport
 */

const TRANSPORTS = Object.freeze({
  live: "sendMessage",
  queued: "transferUserInfo",
  snapshot: "updateApplicationContext",
});

/**
 * Build the rules for one app's command set.
 *
 * @param {object} definition
 * @param {readonly string[]} definition.liveCommands commands that are wrong when late
 * @param {readonly string[]} [definition.queuedCommands] commands that are still true when late
 * @param {number} [definition.stalenessMs] how old a snapshot may be before the
 *   watch must stop presenting its timer as live. Defaults to 30s — long enough
 *   to ride out a normal gap, short enough that a wearer is not reading a
 *   counter that stopped moving a minute ago.
 */
function defineWatchBridge(definition) {
  const live = [...(definition.liveCommands ?? [])];
  const queued = [...(definition.queuedCommands ?? [])];
  if (live.length === 0 && queued.length === 0) throw new Error("defineWatchBridge needs at least one command");
  const overlap = live.filter((kind) => queued.includes(kind));
  if (overlap.length > 0) {
    throw new Error(`a command is either live or queued, never both: ${overlap.join(", ")}`);
  }
  const stalenessMs = definition.stalenessMs ?? 30_000;

  /**
   * Which mechanism carries this command.
   *
   * @param {string} kind
   * @returns {WatchTransport}
   */
  function transportFor(kind) {
    if (queued.includes(kind)) return TRANSPORTS.queued;
    if (live.includes(kind)) return TRANSPORTS.live;
    throw new Error(`unknown watch command ${JSON.stringify(kind)}`);
  }

  /**
   * May this command be sent right now?
   *
   * @param {string} kind
   * @param {{ reachable: boolean }} link
   * @returns {{ ok: true, transport: WatchTransport } | { ok: false, why: "unreachable" }}
   */
  function deliverable(kind, link) {
    const transport = transportFor(kind);
    if (transport === TRANSPORTS.queued) return { ok: true, transport };
    if (!link || link.reachable !== true) return { ok: false, why: "unreachable" };
    return { ok: true, transport };
  }

  /**
   * Stamp a queued command with the moment it was pressed.
   *
   * `elapsedMs` is measured against the session, not the wall clock, because
   * the session is what a person is pointing at when they press the button and
   * because the two devices' clocks are not the same clock.
   *
   * @param {string} kind
   * @param {object} input
   * @param {{ elapsedMs?: number, receivedAt?: number, running?: boolean } | null} input.state the last snapshot the watch holds
   * @param {number} input.now the watch's clock at the moment of the press
   * @returns {{ kind: string, atMs: number, pressedAt: number }}
   */
  function stampCommand(kind, input) {
    if (!queued.includes(kind)) {
      throw new Error(`${JSON.stringify(kind)} is a live command — it is not queued, so it is not stamped`);
    }
    const state = input.state ?? {};
    const since = typeof state.receivedAt === "number" ? Math.max(0, input.now - state.receivedAt) : 0;
    // A paused session's elapsed time does not advance between snapshots, so
    // adding the wall gap would point the flag past the end of the recording.
    const advance = state.running === false ? 0 : since;
    return { kind, atMs: Math.max(0, (state.elapsedMs ?? 0) + advance), pressedAt: input.now };
  }

  /**
   * What the watch should render for the snapshot it holds.
   *
   * A snapshot older than `stalenessMs` is shown as last-known: the elapsed
   * time stops presenting itself as live, and the transport controls go with
   * it, because a control that is disabled for the same reason the timer froze
   * is a coherent screen rather than two unrelated glitches.
   *
   * @param {{ elapsedMs?: number, receivedAt?: number, running?: boolean } | null} state
   * @param {{ now: number, reachable?: boolean }} link
   */
  function presentState(state, link) {
    if (!state) {
      // Not an error state. A watch app that shows "something went wrong" when
      // there is simply no session is a watch app that fails App Store review
      // with the phone in a drawer.
      return { hasSession: false, live: false, stale: false, elapsedMs: 0, controlsEnabled: false };
    }
    const age = typeof state.receivedAt === "number" ? Math.max(0, link.now - state.receivedAt) : Infinity;
    const stale = age > stalenessMs;
    const running = state.running !== false;
    const live = !stale && link.reachable === true && running;
    return {
      hasSession: true,
      live,
      stale,
      ageMs: Number.isFinite(age) ? age : null,
      // Only a live snapshot's timer may keep counting on the wrist.
      elapsedMs: (state.elapsedMs ?? 0) + (live ? age : 0),
      controlsEnabled: link.reachable === true && !stale,
    };
  }

  return { transportFor, deliverable, stampCommand, presentState, live, queued, stalenessMs };
}

module.exports = { TRANSPORTS, defineWatchBridge };
