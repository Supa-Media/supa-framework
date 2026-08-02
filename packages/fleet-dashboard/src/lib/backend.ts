/**
 * Whether this browser talks to the fleet's own Convex backend, and with what.
 *
 * The backend (`apps/fleet-backend` in this repo) holds the two things GitHub
 * cannot: your cross-device review marker, and run telemetry the fleet's jobs
 * post about themselves. It is **optional**. With no URL and no token resolved,
 * `resolveBackend` returns `null`, every call site skips, and the dashboard
 * behaves exactly as it did before this existed — localStorage marker, GitHub
 * data, no extra request.
 *
 * The URL may live in `fleet.config.ts` because a Convex deployment URL is
 * public in the same way a repo slug is: it ships in the bundle, and it grants
 * nothing on its own (every route wants a credential). The **token never does**
 * — it is entered in the gate and kept in this browser's localStorage, beside
 * the GitHub PATs, and travels only to that one URL.
 */

/** localStorage key holding `{ url, readToken }`. */
export const BACKEND_KEY = "fleet-dashboard:backend";

export interface BackendConfig {
  /** Origin of the Convex **HTTP actions** deployment, no trailing slash. */
  url: string;
  readToken: string;
}

/** What the gate stored. Either half may be absent. */
export interface StoredBackend {
  url: string | null;
  readToken: string | null;
}

export const NO_BACKEND: StoredBackend = { url: null, readToken: null };

/** The `getItem`/`setItem`/`removeItem` subset used here, so storage is injectable. */
export interface BackendStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Trim a pasted URL into an origin, or reject it.
 *
 * **`https://`, and a host the CSP will actually allow.** A URL typed into this
 * settings field is about to receive a bearer token on every request, and the
 * page's own CSP (`index.html`, `public/_headers`) allows
 * `connect-src https://*.convex.site` and nothing else. Accepting a URL the
 * browser will then refuse to open turns a typo into a feature that fails
 * silently in a console nobody reads.
 *
 * That argument is about the whole URL, so it is applied to the whole URL. It
 * used to stop at the scheme, which let through the single likeliest paste
 * there is: `https://<name>.convex.cloud` — the wrong one of the two hostnames
 * every Convex deployment has, warned about in `DEPLOY.md`, in
 * `fleet.config.ts`, and right here — accepted at entry and then blocked at the
 * network, which is precisely the failure this function exists to prevent.
 *
 * `localhost` stays allowed as a preview escape hatch, still https-only:
 * `convex dev` hands out an `https://<name>.convex.site` URL, so no ordinary
 * workflow needs http.
 */
export function normalizeBackendUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(".convex.site") && host !== "localhost") return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/**
 * The backend to use, or `null` for "feature off".
 *
 * Both halves are required. A URL with no token would mean every request came
 * back 401 and every panel showed an error for a feature nobody turned on —
 * which is worse than the feature being absent, and much harder to read.
 */
export function resolveBackend(
  configUrl: string | null,
  stored: StoredBackend = NO_BACKEND,
): BackendConfig | null {
  // Stored first: the gate is how you point a browser at a preview deployment
  // without rebuilding the page.
  const url = normalizeBackendUrl(stored.url) ?? normalizeBackendUrl(configUrl);
  const readToken = stored.readToken?.trim() ?? "";
  if (url === null || readToken === "") return null;
  return { url, readToken };
}

function browserStore(): BackendStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Total parse: anything that is not `{ url?, readToken? }` of strings reads as absent. */
export function loadBackendSettings(store: BackendStore | null = browserStore()): StoredBackend {
  if (store === null) return NO_BACKEND;
  let raw: string | null;
  try {
    raw = store.getItem(BACKEND_KEY);
  } catch {
    return NO_BACKEND;
  }
  if (raw === null) return NO_BACKEND;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return NO_BACKEND;
    const record = parsed as Record<string, unknown>;
    return {
      url: typeof record.url === "string" && record.url.trim() !== "" ? record.url.trim() : null,
      readToken:
        typeof record.readToken === "string" && record.readToken.trim() !== ""
          ? record.readToken.trim()
          : null,
    };
  } catch {
    return NO_BACKEND;
  }
}

export function saveBackendSettings(
  settings: StoredBackend,
  store: BackendStore | null = browserStore(),
): void {
  if (store === null) return;
  try {
    if (settings.url === null && settings.readToken === null) store.removeItem(BACKEND_KEY);
    else store.setItem(BACKEND_KEY, JSON.stringify(settings));
  } catch {
    // Private mode: the setting lasts for this page load, which is the correct
    // behaviour for the session you are in.
  }
}

export function clearBackendSettings(store: BackendStore | null = browserStore()): void {
  if (store === null) return;
  try {
    store.removeItem(BACKEND_KEY);
  } catch {
    // Nothing to clean up.
  }
}
