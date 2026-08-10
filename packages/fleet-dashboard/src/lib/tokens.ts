/**
 * Which token talks to which repo.
 *
 * A fine-grained GitHub PAT is scoped to exactly one **resource owner**, and the
 * fleet spans three of them — `togathernyc` (togather), `Supa-Media` (events-os,
 * supa-framework), and `shyoh` (fount-studios). No single fine-grained token can
 * reach all four repos, so the dashboard holds one token per owner and routes
 * every request by the owner half of the repo slug.
 *
 * The owner is **derived** from `slug`, never configured beside it: `fleet.config`
 * already spells `owner/name` exactly as GitHub does, and a second field saying
 * the same thing is a field that can disagree with the first one.
 *
 * Everything here is pure but for the three storage functions, which take an
 * injectable store so the migration path is testable.
 */

/** localStorage key holding the owner → token map. */
export const TOKENS_KEY = "fleet-dashboard:tokens";

/**
 * The single-token key v2 used, read once and then deleted. See `loadTokens`.
 */
export const LEGACY_TOKEN_KEY = "fleet-dashboard:token";

/** Resource owner → that owner's PAT. Owners with no token are simply absent. */
export type TokenMap = Record<string, string>;

/**
 * The two fields grouping needs. `RepoConfig` satisfies it structurally, which
 * keeps `lib/` free of a dependency on the config's full shape.
 */
export interface OwnedRepo {
  slug: string;
  label: string;
}

export interface OwnerGroup<T extends OwnedRepo = OwnedRepo> {
  /** The resource owner, spelled as `fleet.config.ts` spells it. */
  owner: string;
  /** Every repo one token for `owner` covers, in config order. */
  repos: T[];
}

/** The `getItem`/`setItem`/`removeItem` subset of `Storage` this module uses. */
export interface TokenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The `owner` half of an `owner/name` slug. */
export function ownerOf(slug: string): string {
  const owner = slug.split("/")[0];
  if (owner === undefined || owner === "" || !slug.includes("/")) {
    throw new Error(`"${slug}" is not an owner/name repo slug`);
  }
  return owner;
}

/** The `name` half of an `owner/name` slug — what the gate lists per owner. */
export function repoName(slug: string): string {
  return slug.slice(ownerOf(slug).length + 1);
}

/**
 * The fleet's distinct owners, each with the repos its token covers.
 *
 * Order follows `fleet.config.ts` so the gate's fields, the header's warning,
 * and the per-owner search requests all appear in one predictable order.
 */
export function fleetOwners<T extends OwnedRepo>(repos: readonly T[]): Array<OwnerGroup<T>> {
  const groups = new Map<string, OwnerGroup<T>>();
  for (const repo of repos) {
    const owner = ownerOf(repo.slug);
    const existing = groups.get(owner.toLowerCase());
    if (existing === undefined) groups.set(owner.toLowerCase(), { owner, repos: [repo] });
    else existing.repos.push(repo);
  }
  return [...groups.values()];
}

/**
 * The token for `owner`, or `null`.
 *
 * Matched case-insensitively: GitHub logins are, and a map typed by hand (or
 * written by a build that spelled `supa-media`) must not silently miss the repo
 * whose config says `Supa-Media`.
 */
export function tokenForOwner(tokens: TokenMap, owner: string): string | null {
  const wanted = owner.toLowerCase();
  for (const [key, token] of Object.entries(tokens)) {
    if (key.toLowerCase() === wanted && token !== "") return token;
  }
  return null;
}

/** The token covering an `owner/name` slug, or `null`. */
export function tokenForRepo(tokens: TokenMap, slug: string): string | null {
  return tokenForOwner(tokens, ownerOf(slug));
}

/** Owners in the fleet with no token loaded — what the header's ⚠ names. */
export function ownersMissingToken(
  tokens: TokenMap,
  repos: readonly OwnedRepo[],
): string[] {
  return fleetOwners(repos)
    .filter((group) => tokenForOwner(tokens, group.owner) === null)
    .map((group) => group.owner);
}

/** Whether anything at all is loaded — one owner's token is enough to sign in. */
export function hasAnyToken(tokens: TokenMap): boolean {
  return Object.values(tokens).some((token) => token !== "");
}

/**
 * Fold what was typed into the gate over what is already stored.
 *
 * A blank field **keeps** the saved token rather than clearing it. The gate is
 * reachable from the header mid-session, so its common visit is "one token
 * expired, replace that one" — and making that visit also require re-pasting the
 * two that still work would be a trap dressed as a form. Clearing them all is
 * what Sign out is for; clearing exactly one is what `dropTokens` is for.
 *
 * The write is case-insensitive like every other lookup in this module. Storing
 * under the entered spelling alone would leave a re-cased owner (`supa-media` in
 * storage, `Supa-Media` in the config) holding *both* keys — and `tokenForOwner`
 * scans in insertion order, so it would keep handing back the stale one.
 */
export function mergeTokens(existing: TokenMap, entered: Record<string, string>): TokenMap {
  const merged: TokenMap = { ...existing };
  for (const [owner, value] of Object.entries(entered)) {
    const trimmed = value.trim();
    if (trimmed === "") continue;
    for (const key of ownerKeys(merged, owner)) delete merged[key];
    merged[owner] = trimmed;
  }
  return merged;
}

/** Every key of `tokens` naming `owner`, whatever its casing. */
function ownerKeys(tokens: TokenMap, owner: string): string[] {
  const wanted = owner.toLowerCase();
  return Object.keys(tokens).filter((key) => key.toLowerCase() === wanted);
}

function browserStore(): TokenStore | null {
  try {
    return localStorage;
  } catch {
    // Storage disabled, or no DOM at all (tests, SSR): the caller degrades to
    // an in-memory map for the session.
    return null;
  }
}

/**
 * Read the owner → token map, migrating v2's single-token key on the way.
 *
 * v2 accepted one token and sent it everywhere, which is precisely the thing
 * fine-grained PATs cannot do. That token is still in someone's browser, so it
 * is applied to **every owner that has none** and the old key is deleted — once,
 * because the delete is what makes it once. It probably only really covers one
 * owner; the other two will 401, and a 401 arrives as a named line in the
 * Partial-data banner ("Supa-Media — GitHub rejected the token") rather than as
 * a blank page. Guessing which owner it belongs to is not possible from here,
 * and dropping it silently would sign the user out for no visible reason.
 */
export function loadTokens(
  owners: readonly string[],
  store: TokenStore | null = browserStore(),
): TokenMap {
  if (store === null) return {};
  const tokens = parseTokens(read(store, TOKENS_KEY));

  const legacy = read(store, LEGACY_TOKEN_KEY);
  if (legacy !== null && legacy.trim() !== "") {
    for (const owner of owners) {
      if (tokenForOwner(tokens, owner) === null) tokens[owner] = legacy.trim();
    }
    saveTokens(tokens, store);
    try {
      store.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      // Nothing to clean up; the map above already won.
    }
  }

  return tokens;
}

export function saveTokens(
  tokens: TokenMap,
  store: TokenStore | null = browserStore(),
): void {
  if (store === null) return;
  try {
    store.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // Private-mode browsers: the map stays in memory for this session only.
  }
}

/** Forget every token, including the legacy key if a migration never ran. */
export function clearTokens(store: TokenStore | null = browserStore()): void {
  if (store === null) return;
  try {
    store.removeItem(TOKENS_KEY);
    store.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Nothing to clean up.
  }
}

function read(store: TokenStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** Total parse: anything that isn't an object of non-empty strings is `{}`. */
function parseTokens(raw: string | null): TokenMap {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const tokens: TokenMap = {};
    for (const [owner, token] of Object.entries(parsed)) {
      if (typeof token === "string" && token.trim() !== "") tokens[owner] = token.trim();
    }
    return tokens;
  } catch {
    return {};
  }
}
