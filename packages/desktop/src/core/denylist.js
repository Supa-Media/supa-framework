/**
 * "Never do this for these apps", and what that has to mean to be worth having.
 *
 * A denylist is the promise that makes an app which watches the desktop
 * acceptable at all: a person names the thing they want left alone — a therapy
 * call, a 1:1 tool, a bank's support app — and the machine leaves it alone. So
 * the framework ships the *matcher* rather than leaving every app to write its
 * own, because the matcher is where this promise is quietly broken.
 *
 * ## The matching rule, stated once
 *
 * The same application arrives under four names on macOS — `Zoom`, `zoom.us`,
 * `us.zoom.xos`, `/Applications/zoom.us.app` — and a person types one word. So
 * an entry matches when, after lowercasing and stripping any directory path and
 * a trailing `.app`, it equals the candidate, or equals one of the candidate's
 * dot-separated segments, or equals a segment or suffix of a candidate URL's
 * host.
 *
 * It is deliberately **not** a substring match. `zoom` blocking `Zoombini`, or
 * `meet` blocking `Meetup`, is a denylist that silently stops the app doing its
 * job for something its owner never named — and they would have no way to find
 * out why, because a denied thing leaves no trace on purpose. Segment equality
 * is the widest rule that cannot do that.
 *
 * A host's final segment alone is never a match: `teams.microsoft.com` is
 * matched by `teams`, by `microsoft.com` and by the whole host, but `com` must
 * not deny the internet.
 *
 * ## Honour it twice
 *
 * The apps this came from check the list in two places, and the reason is worth
 * repeating here because a single check always looks sufficient:
 *
 *  1. **Before observation.** `withoutDenied` strips denied things out of a
 *     collected signal list *before* anything downstream sees them, so a denied
 *     app's window title never reaches a log line, a tooltip, an evidence list
 *     or a crash report.
 *  2. **Before the privileged action.** `isDenied` is asked again at the
 *     consent gate (`./consent.js`), so something that arrived by another route
 *     still cannot start a capture.
 *
 * (1) keeps the denied app out of the user interface; (2) keeps it out of the
 * microphone. Removing either leaves a real hole.
 */

/**
 * Reduce an app name, bundle id or path to the token a person would type.
 * `/Applications/zoom.us.app` and `zoom.us` both become `zoom.us`.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeAppName(name) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim().toLowerCase();
  if (trimmed === "") return "";
  const leaf = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  return leaf.endsWith(".app") ? leaf.slice(0, -4) : leaf;
}

/**
 * The denylist as normalised tokens.
 *
 * Empty entries are dropped here rather than trusted to be absent. Today that
 * is unreachable defence — `nameSegments` and `hostSegments` both drop empty
 * segments, so an empty entry has nothing to match — and the denylist test
 * records it as such rather than pretending it is covered. It stays because a
 * list containing `""` matching every candidate with an empty normalised name
 * would be "denies everything", which is not a failure anybody could diagnose
 * from the outside, and it is one loosened `filter(Boolean)` away.
 *
 * @param {readonly string[]} denylist
 */
function entrySet(denylist) {
  if (!Array.isArray(denylist)) return new Set();
  return new Set(denylist.map(normalizeAppName).filter((entry) => entry !== ""));
}

/** The candidate name plus each of its dot-separated segments. */
function nameSegments(candidate) {
  const normalized = normalizeAppName(candidate);
  if (normalized === "") return [];
  return [normalized, ...normalized.split(".").filter(Boolean)];
}

/** A host, each of its labels bar the public suffix, and each of its suffixes. */
function hostSegments(url) {
  if (typeof url !== "string" || url === "") return [];
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  if (host === "") return [];
  const parts = host.split(".").filter(Boolean);
  const suffixes = [];
  for (let i = 0; i < parts.length - 1; i += 1) suffixes.push(parts.slice(i).join("."));
  return [host, ...parts.slice(0, -1), ...suffixes];
}

/**
 * True when `candidate` — an app name, bundle id or path — is on the list.
 *
 * @param {string | undefined | null} candidate
 * @param {readonly string[]} denylist
 */
export function isDeniedApp(candidate, denylist) {
  if (!candidate) return false;
  const entries = entrySet(denylist);
  if (entries.size === 0) return false;
  return nameSegments(candidate).some((segment) => entries.has(segment));
}

/**
 * True when `url`'s host is on the list.
 *
 * @param {string | undefined | null} url
 * @param {readonly string[]} denylist
 */
export function isDeniedUrl(url, denylist) {
  if (!url) return false;
  const entries = entrySet(denylist);
  if (entries.size === 0) return false;
  return hostSegments(url).some((segment) => entries.has(segment));
}

/**
 * True when a subject names a denied app *or* points at a denied host.
 *
 * This is the shape the consent gate asks about, and the one to reach for
 * anywhere a thing has both a name and an address.
 *
 * @param {{ app?: string | null, url?: string | null }} subject
 * @param {readonly string[]} denylist
 */
export function isDenied(subject, denylist) {
  if (!subject) return false;
  return isDeniedApp(subject.app, denylist) || isDeniedUrl(subject.url, denylist);
}

/**
 * The list a denied thing is absent from.
 *
 * `describe` maps one item to the `{ app, url }` a denial is decided on, so the
 * same filter works over process names, window records, or anything else a
 * collector produced. It is a filter rather than a redaction because a denied
 * item must not survive as a placeholder either: "1 hidden app" is still a
 * report about something its owner asked us not to report on.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {readonly string[]} denylist
 * @param {(item: T) => ({ app?: string | null, url?: string | null } | string)} describe
 * @returns {T[]}
 */
export function withoutDenied(items, denylist, describe = (item) => item) {
  if (!Array.isArray(items)) return [];
  if (!Array.isArray(denylist) || denylist.length === 0) return [...items];
  return items.filter((item) => {
    const described = describe(item);
    const subject = typeof described === "string" ? { app: described } : described;
    return !isDenied(subject ?? {}, denylist);
  });
}
