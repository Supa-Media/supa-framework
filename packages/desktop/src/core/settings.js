/**
 * What a desktop app remembers between launches, and how a broken file is repaired.
 *
 * A desktop app's settings file is on a disk its owner controls, so it is
 * reachable by anything else on that machine: another program, a sync client, a
 * half-finished write during a power cut, or a hand edit. That makes it a
 * security control rather than a convenience, and two rules follow. Both are
 * enforced by `normalize` rather than asserted in a comment:
 *
 * **A malformed file never widens permission.** Every field that fails to parse
 * resolves to the value the author declared as the *safe* one, not to a
 * plausible one. `normalize` never throws, because a settings file that crashes
 * the app on launch is a settings file somebody deletes — along with whatever
 * they had turned off in it.
 *
 * **Some fields are stickier than the schema.** A field marked `sticky` is read
 * *before* the version check, so a record written by a version this build does
 * not understand still carries it. That is the right direction for exactly one
 * class of field: a list of things the app was told never to do. Dropping a
 * corrupt denylist would start doing the thing its owner forbade; keeping a
 * corrupt feature flag would not.
 *
 * **There is no credential here.** A token belongs in the OS keychain behind
 * `TokenStore` (`./tokenStore.js`), never in this file — see the `safeStorage`
 * store in `@supa-media/desktop/electron`.
 *
 * @example
 * ```js
 * const settings = defineSettings({
 *   version: 1,
 *   fields: {
 *     captureEnabled: boolField(false),
 *     askEveryTime: boolField(true),
 *     denylist: stringListField({ sticky: true }),
 *     endpoint: endpointField(),
 *     theme: enumField(["light", "dark"], "dark"),
 *   },
 * });
 *
 * settings.normalize(JSON.parse(await readFile(path, "utf8")));
 * ```
 */

/**
 * A boolean that falls back to `fallback` for *anything* that is not a boolean.
 *
 * Deliberately not `Boolean(value)`. `Boolean(undefined)` is `false`, and for a
 * field like "ask before every capture" `false` is the permissive answer — so
 * coercion turns a missing field into a silent yes. `"no"` is worse: it is a
 * truthy string, so coercion reads a person's plain-English refusal as consent.
 *
 * @param {boolean} fallback the safe value for this field
 */
export function boolField(fallback) {
  return {
    default: fallback,
    parse: (value) => (typeof value === "boolean" ? value : fallback),
  };
}

/**
 * A trimmed non-empty string, or `null`.
 *
 * @param {string | null} [fallback]
 */
export function stringField(fallback = null) {
  return {
    default: fallback,
    parse: (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : fallback),
  };
}

/**
 * One of a fixed set of strings.
 *
 * @param {readonly string[]} values
 * @param {string} fallback must itself be one of `values`
 */
export function enumField(values, fallback) {
  if (!values.includes(fallback)) {
    throw new Error(`enumField fallback ${JSON.stringify(fallback)} is not one of ${values.join(", ")}`);
  }
  return {
    default: fallback,
    parse: (value) => (typeof value === "string" && values.includes(value) ? value : fallback),
  };
}

/**
 * A deduplicated list of trimmed non-empty strings.
 *
 * Pass `{ sticky: true }` for a denylist — see the file header for why that
 * direction is the safe one only for lists of things not to do.
 *
 * @param {{ sticky?: boolean }} [options]
 */
export function stringListField(options = {}) {
  return {
    default: [],
    sticky: options.sticky === true,
    parse: (value) =>
      Array.isArray(value)
        ? [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim()))]
        : [],
  };
}

/**
 * An HTTPS endpoint this app is willing to talk to, normalised, or `null`.
 *
 * @param {{ allowLoopbackHttp?: boolean }} [options]
 */
export function endpointField(options = {}) {
  return {
    default: null,
    parse: (value) => acceptableEndpointUrl(value, options),
  };
}

/**
 * The endpoints a desktop app may be pointed at, and the two it may not.
 *
 * **`https` only.** Plain `http` on a laptop means any coffee-shop network can
 * read and rewrite what the app sends.
 *
 * **No credentials in the URL.** `https://user:pass@host` would put a secret in
 * a settings file, in every log line that echoed the base URL, and in the
 * `Referer` of anything a renderer loaded from it. Refused outright rather than
 * stripped, so a person who pasted one is told rather than silently disarmed.
 *
 * `http` is allowed for loopback, because self-hosting against a local server
 * is a supported path and there is no network in the way. Turn that off with
 * `{ allowLoopbackHttp: false }`.
 *
 * The result is stored without a trailing slash so route concatenation has
 * exactly one shape.
 *
 * @param {unknown} value
 * @param {{ allowLoopbackHttp?: boolean }} [options]
 * @returns {string | null}
 */
export function acceptableEndpointUrl(value, options = {}) {
  const allowLoopbackHttp = options.allowLoopbackHttp !== false;
  if (typeof value !== "string" || value.trim() === "") return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(allowLoopbackHttp && url.protocol === "http:" && loopback)) return null;
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/**
 * Turn a field declaration into a defaults record and a repair function.
 *
 * @param {{ version: number, fields: Record<string, { default: unknown, sticky?: boolean, parse: (value: unknown) => unknown }> }} definition
 */
export function defineSettings(definition) {
  const { version, fields } = definition;
  if (!Number.isInteger(version)) throw new Error("defineSettings needs an integer version");

  const names = Object.keys(fields);
  const sticky = names.filter((name) => fields[name].sticky === true);

  /**
   * The safe resting state.
   *
   * Frozen, and its array values are frozen too, so that a caller who reads
   * `defaults.denylist` and pushes to it cannot quietly change what every later
   * fresh install starts from. `normalize` never hands this record out — it
   * builds a new one through `parse` — so the freeze is a guard on the export
   * rather than on the hot path.
   */
  const defaults = Object.freeze(
    Object.fromEntries([
      ["version", version],
      ...names.map((name) => {
        const value = fields[name].default;
        return [name, Array.isArray(value) ? Object.freeze([...value]) : value];
      }),
    ]),
  );

  /**
   * Repair anything into a usable record. Never throws.
   *
   * @param {unknown} raw whatever was on disk — parsed JSON, `undefined`, a string, a lie
   */
  function normalize(raw) {
    const source = typeof raw === "object" && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {};

    // Sticky fields are read before the version check on purpose: a record from
    // a version we do not understand still knows what it was told not to do,
    // and that instruction outlives the schema it was written in.
    const kept = Object.fromEntries(sticky.map((name) => [name, fields[name].parse(source[name])]));

    // A record from another version resolves every field through `parse` with
    // nothing, rather than by spreading `defaults` — so a list field hands back
    // a fresh array rather than the one every other caller is holding.
    if (source["version"] !== version) {
      return {
        version,
        ...Object.fromEntries(names.map((name) => [name, fields[name].parse(undefined)])),
        ...kept,
      };
    }

    return {
      version,
      ...Object.fromEntries(names.map((name) => [name, fields[name].parse(source[name])])),
    };
  }

  return { version, defaults, normalize, fieldNames: names };
}
