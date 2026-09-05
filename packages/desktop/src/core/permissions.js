/**
 * Asking the operating system for something, at the moment it is needed.
 *
 * macOS shows one system dialog per permission, once, and a person who denies
 * it has to go to System Settings to change their mind. That makes *when* an app
 * asks a design decision rather than an implementation detail, and it is the
 * decision most desktop apps get wrong:
 *
 * **Never at launch.** An app that asks for the microphone and screen recording
 * on first run, before it has done anything, is asking a person to trust a
 * dialog rather than a behaviour — and it is the shape every piece of desktop
 * spyware has. Ask when a person has just pressed a button about something they
 * can see named on screen, so the dialog has an obvious cause.
 *
 * **With an honest reason.** The rationale passed here is the same sentence
 * that belongs in the `Info.plist` usage description and on screen immediately
 * before the system dialog. It names what is captured and where it goes.
 *
 * **A denied permission is never re-requested.** macOS ignores the call, so the
 * app would look frozen while nothing happened. `ensurePermissions` asks only
 * for permissions that have never been decided, and reports the rest as missing
 * so the caller can offer the System Settings route instead — which
 * `openPermissionSettings` in `@supa-media/desktop/electron` opens directly.
 *
 * The broker is an interface because `systemPreferences` cannot run in CI, and
 * because the *order* of these calls is the thing worth testing:
 * `fakePermissionBroker` records every call, which is how "nothing was even
 * requested before consent" gets asserted rather than promised.
 *
 * @typedef {"granted" | "denied" | "restricted" | "not-determined" | "unknown"} PermissionStatus
 * @typedef {{ status: (kind: string) => Promise<PermissionStatus>, request: (kind: string, rationale: string) => Promise<PermissionStatus> }} PermissionBroker
 */

/**
 * Ensure every permission an action needs, asking only for the undecided ones.
 *
 * @param {PermissionBroker} broker
 * @param {readonly string[]} needs
 * @param {Record<string, string>} rationales what each permission is for, in the words a person is shown
 * @returns {Promise<{ ok: boolean, missing: string[], statuses: Record<string, PermissionStatus> }>}
 */
export async function ensurePermissions(broker, needs, rationales = {}) {
  /** @type {Record<string, PermissionStatus>} */
  const statuses = {};
  const missing = [];

  // Sequential rather than `Promise.all`: two system dialogs raced against each
  // other stack on top of one another, and the person answers whichever one is
  // in front without reading the other.
  for (const kind of needs) {
    let status = await broker.status(kind);
    if (status === "not-determined" || status === "unknown") {
      status = await broker.request(kind, rationales[kind] ?? "");
    }
    statuses[kind] = status;
    if (status !== "granted") missing.push(kind);
  }

  return { ok: missing.length === 0, missing, statuses };
}

/**
 * A broker that answers from a table and records what it was asked.
 *
 * `calls` is the assertion surface: `["status:microphone"]` after a refused
 * consent proves no dialog was raised, which is a stronger statement than "the
 * recorder was not started".
 *
 * @param {Record<string, PermissionStatus>} [initial]
 * @param {Record<string, PermissionStatus>} [onRequest] what each request resolves to
 * @returns {PermissionBroker & { calls: string[] }}
 */
export function fakePermissionBroker(initial = {}, onRequest = {}) {
  const table = { ...initial };
  const calls = [];
  return {
    calls,
    async status(kind) {
      calls.push(`status:${kind}`);
      return table[kind] ?? "not-determined";
    },
    async request(kind) {
      calls.push(`request:${kind}`);
      table[kind] = onRequest[kind] ?? "granted";
      return table[kind];
    },
  };
}
