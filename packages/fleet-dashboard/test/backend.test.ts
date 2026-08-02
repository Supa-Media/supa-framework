import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BACKEND_KEY,
  clearBackendSettings,
  loadBackendSettings,
  NO_BACKEND,
  normalizeBackendUrl,
  resolveBackend,
  saveBackendSettings,
  type BackendStore,
} from "../src/lib/backend";

/**
 * The backend is optional, and "optional" has to mean *nothing happens* — not
 * "happens badly". Most of these assert the off states.
 */

function store(initial: Record<string, string> = {}): BackendStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A store whose every method throws, i.e. a locked-down / private-mode browser. */
const hostile: BackendStore = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("denied");
  },
  removeItem() {
    throw new Error("denied");
  },
};

test("normalizeBackendUrl accepts https and strips the trailing slash", () => {
  assert.equal(normalizeBackendUrl("https://x.convex.site/"), "https://x.convex.site");
  assert.equal(normalizeBackendUrl("  https://x.convex.site  "), "https://x.convex.site");
  assert.equal(normalizeBackendUrl("https://x.convex.site/base//"), "https://x.convex.site/base");
});

/**
 * The page's CSP allows `connect-src https://*.convex.site` and nothing else,
 * so an http URL accepted here would be a feature that fails in the console.
 */
test("normalizeBackendUrl refuses plain http, on localhost too", () => {
  assert.equal(normalizeBackendUrl("http://x.convex.site"), null);
  assert.equal(normalizeBackendUrl("http://localhost:3210"), null);
  assert.equal(normalizeBackendUrl("http://127.0.0.1:3210"), null);
});

test("normalizeBackendUrl rejects junk", () => {
  for (const raw of ["", "   ", "x.convex.site", "javascript:alert(1)", null, undefined, 3 as never]) {
    assert.equal(normalizeBackendUrl(raw as string), null, `expected null for ${String(raw)}`);
  }
});

test("resolveBackend is null with no config and no stored settings — the default is off", () => {
  assert.equal(resolveBackend(null), null);
  assert.equal(resolveBackend(null, NO_BACKEND), null);
});

test("resolveBackend needs both halves: a URL with no token is still off", () => {
  assert.equal(resolveBackend("https://x.convex.site", NO_BACKEND), null);
  assert.equal(resolveBackend(null, { url: null, readToken: "t" }), null);
  assert.equal(resolveBackend("https://x.convex.site", { url: null, readToken: "   " }), null);
});

test("resolveBackend combines the config URL with a stored token", () => {
  assert.deepEqual(resolveBackend("https://x.convex.site/", { url: null, readToken: " t " }), {
    url: "https://x.convex.site",
    readToken: "t",
  });
});

test("a stored URL overrides the config one, so a browser can aim at a preview", () => {
  assert.deepEqual(
    resolveBackend("https://prod.convex.site", { url: "https://preview.convex.site", readToken: "t" }),
    { url: "https://preview.convex.site", readToken: "t" },
  );
});

test("an unusable stored URL falls back to the config one rather than turning the feature off", () => {
  assert.deepEqual(resolveBackend("https://prod.convex.site", { url: "nonsense", readToken: "t" }), {
    url: "https://prod.convex.site",
    readToken: "t",
  });
});

test("settings round-trip through storage", () => {
  const s = store();
  saveBackendSettings({ url: "https://x.convex.site", readToken: "t" }, s);
  assert.deepEqual(loadBackendSettings(s), { url: "https://x.convex.site", readToken: "t" });
});

test("saving an empty pair removes the key rather than storing nulls", () => {
  const s = store({ [BACKEND_KEY]: JSON.stringify({ url: "https://x", readToken: "t" }) });
  saveBackendSettings(NO_BACKEND, s);
  assert.equal(s.data[BACKEND_KEY], undefined);
});

test("clearBackendSettings forgets the token — sign out must not leave a credential behind", () => {
  const s = store({ [BACKEND_KEY]: JSON.stringify({ url: "https://x", readToken: "secret" }) });
  clearBackendSettings(s);
  assert.deepEqual(loadBackendSettings(s), NO_BACKEND);
});

test("a corrupt or wrongly-shaped stored value reads as absent", () => {
  for (const raw of ["{not json", "[]", '"a string"', "null", JSON.stringify({ url: 7 })]) {
    assert.deepEqual(
      loadBackendSettings(store({ [BACKEND_KEY]: raw })).readToken,
      null,
      `expected absent for ${raw}`,
    );
  }
});

test("blank strings in the stored value read as absent, not as empty credentials", () => {
  const s = store({ [BACKEND_KEY]: JSON.stringify({ url: "  ", readToken: "" }) });
  assert.deepEqual(loadBackendSettings(s), NO_BACKEND);
});

test("a storage that throws degrades to off rather than taking the page down", () => {
  assert.deepEqual(loadBackendSettings(hostile), NO_BACKEND);
  assert.doesNotThrow(() => saveBackendSettings({ url: "https://x", readToken: "t" }, hostile));
  assert.doesNotThrow(() => clearBackendSettings(hostile));
  assert.deepEqual(loadBackendSettings(null), NO_BACKEND);
});
