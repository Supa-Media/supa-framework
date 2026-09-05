/**
 * The one place that decides whether a privileged capture may begin.
 *
 * A desktop app that watches the machine — a microphone, the screen, the
 * clipboard, the window list — needs exactly one function that turns
 * *observation* into *permission to act*, small enough to read on one screen and
 * pure enough to test without an operating system. This is that function,
 * lifted out of a meeting recorder where it was the load-bearing piece.
 *
 * ## What is generic here, and what the app still owns
 *
 * This module decides **whether**. The app decides **what an episode is** — see
 * `episode` below — and what the capture actually does. Detection, recording,
 * and every word shown to a person stay in the app.
 *
 * ## The rules
 *
 * **Nothing captures without a yes.** Either the person answers the prompt now,
 * or they turned off "ask every time" earlier, which is the same yes given once.
 * There is no third path — no "we were confident so we started anyway".
 *
 * **A no is sticky for that episode.** A watcher that polls every few seconds
 * and re-asks on every poll turns "Not now" into "ask me again in five seconds,
 * forever", and a person ends up pressing yes to make it stop. So a decision is
 * recorded against the *episode*, and only a genuinely new episode asks again.
 *
 * **The denylist wins over everything, including an explicit yes.** It is
 * checked first, so the reason a person is shown is the specific one they
 * configured rather than the general one, and so a stale grant cannot outlive
 * a denial added since.
 *
 * **No history is kept.** `ConsentState` holds one episode and one decision.
 * A record of everything somebody declined to have recorded is itself a
 * surveillance log, and this app is not going to keep one.
 *
 * ## Episodes
 *
 * An episode key is a string the app mints for "this activation of the thing we
 * might capture", and its identity is the whole design. Two consecutive calls
 * in the same app must produce two keys, or a decline for the first silences the
 * prompt for the second; a single call observed across fifty polls must produce
 * one key, or the prompt reappears forever. Composing the source and the instant
 * the watcher activated — `` `${kind}:${app}:${since}` `` — is the shape that
 * gets both right, and `episodeKey` builds it.
 */

/**
 * @typedef {"no-episode" | "capture-disabled" | "denied" | "declined-this-episode" | "already-asking" | "already-capturing"} HoldReason
 * @typedef {{ episode: string | null, decision: "asking" | "granted" | "declined" | null }} ConsentState
 */

/** No episode, no decision. The resting state, and what a forget returns to. */
export const IDLE_CONSENT = Object.freeze({ episode: null, decision: null });

/**
 * Compose an episode key from what is being captured and when it started.
 *
 * The instant is what distinguishes two calls in the same app; the source is
 * what stops a grant following a person somewhere they did not agree to when
 * the subject changes mid-episode. Returns `null` when there is nothing
 * happening, which `decideConsent` reads as `no-episode`.
 *
 * @param {{ active: boolean, since: string | number | null, source?: { kind?: string, app?: string | null } | null } | null | undefined} activation
 * @returns {string | null}
 */
export function episodeKey(activation) {
  if (!activation || !activation.active || activation.since === null || activation.since === undefined) return null;
  const source = activation.source ?? {};
  return `${source.kind ?? "unknown"}:${source.app ?? ""}:${activation.since}`;
}

/**
 * The decision. Pure: same input, same answer, no clock, no I/O.
 *
 * @param {object} input
 * @param {string | null} input.episode what is happening, or `null` for nothing
 * @param {ConsentState} input.consent what was decided about an episode already
 * @param {boolean} input.denied the denylist's answer for this episode's subject
 * @param {boolean} input.captureEnabled the hard switch — off is a full stop
 * @param {boolean} input.askEveryTime false means consent was given once, in advance
 * @param {boolean} input.busy a capture is already running; a second must not start
 * @returns {{ kind: "ask", episode: string } | { kind: "start", episode: string } | { kind: "hold", why: HoldReason }}
 */
export function decideConsent({ episode, consent, denied, captureEnabled, askEveryTime, busy }) {
  if (episode === null || episode === undefined) return { kind: "hold", why: "no-episode" };

  // Checked before `captureEnabled` so the reason reported is the specific one
  // the person configured, not the general one.
  if (denied) return { kind: "hold", why: "denied" };
  if (!captureEnabled) return { kind: "hold", why: "capture-disabled" };
  if (busy) return { kind: "hold", why: "already-capturing" };

  if (consent && consent.episode === episode) {
    if (consent.decision === "declined") return { kind: "hold", why: "declined-this-episode" };
    if (consent.decision === "asking") return { kind: "hold", why: "already-asking" };
    if (consent.decision === "granted") return { kind: "start", episode };
  }

  return askEveryTime ? { kind: "ask", episode } : { kind: "start", episode };
}

/**
 * The prompt went up.
 *
 * @param {string} episode
 * @returns {ConsentState}
 */
export function asked(episode) {
  return { episode, decision: "asking" };
}

/**
 * A person pressed a button.
 *
 * `episode` is required, and the caller must compare it against the episode
 * that is live *now* before applying the result: answering a prompt that has
 * already been superseded — the thing ended while the window was up — must not
 * grant consent for whatever is happening instead.
 *
 * @param {string} episode
 * @param {"granted" | "declined"} answer
 * @returns {ConsentState}
 */
export function answered(episode, answer) {
  return { episode, decision: answer };
}

/**
 * The episode is over. Forget the decision — and only that decision, so a
 * stale `cleared` event cannot wipe a fresh grant.
 *
 * @param {ConsentState} consent
 * @param {string | null} episode
 * @returns {ConsentState}
 */
export function forgetEpisode(consent, episode) {
  return consent && consent.episode === episode ? IDLE_CONSENT : consent;
}
