/**
 * Tests for the react-resolution guard.
 *
 * Uses Node's built-in test runner (`node --test`, Node >=22) — no extra deps.
 * Builds real node_modules fixtures on disk in a temp dir so resolution runs
 * against actual layouts, then asserts the guard's verdict.
 *
 * The three fixtures cover the cases the guard must get right:
 *   (i)   healthy HOISTED (node-linker=hoisted) — the events-os layout, with NO
 *         app-local react copy. The old guard failed this; the new one passes.
 *   (ii)  healthy ISOLATED (default pnpm linker) — app-local symlinks into the
 *         .pnpm store.
 *   (iii) DUAL-React hazard — a native package keyed to a second React. Must fail.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { checkReactResolution } = require("../dist/react-resolution.js");

// ----- fixture DSL -----------------------------------------------------------

function pkg(dir, name, version, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version, ...extra }, null, 2)
  );
}

function link(from, to) {
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
  fs.symlinkSync(to, from);
}

function workspaceBase(root) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "ws", private: true }));
}

/**
 * Healthy hoisted layout (mirrors events-os): react/react-dom/expo-modules-core
 * hoisted to the top-level node_modules, react-native/react-native-web living in
 * the .pnpm store with top-level symlinks, and — crucially — NO app-local react.
 * With `badReactForExpo`, a second React is injected and expo-modules-core is
 * re-keyed to it (the runtime hazard).
 */
function buildHoisted(root, { badReactForExpo = false } = {}) {
  workspaceBase(root);
  const nm = path.join(root, "node_modules");
  const store = path.join(nm, ".pnpm");

  pkg(path.join(store, "react@19.1.0/node_modules/react"), "react", "19.1.0");
  pkg(path.join(store, "react-dom@19.1.0/node_modules/react-dom"), "react-dom", "19.1.0");
  link(path.join(store, "react-dom@19.1.0/node_modules/react"), "../../react@19.1.0/node_modules/react");

  // hoisted top-level copies
  pkg(path.join(nm, "react"), "react", "19.1.0");
  pkg(path.join(nm, "react-dom"), "react-dom", "19.1.0");
  pkg(path.join(nm, "expo-modules-core"), "expo-modules-core", "3.0.30");

  // native packages in the store, top-level symlinks
  pkg(path.join(store, "react-native@0.81.5/node_modules/react-native"), "react-native", "0.81.5");
  link(path.join(store, "react-native@0.81.5/node_modules/react"), "../../react@19.1.0/node_modules/react");
  link(path.join(nm, "react-native"), ".pnpm/react-native@0.81.5/node_modules/react-native");

  pkg(path.join(store, "react-native-web@0.21.2/node_modules/react-native-web"), "react-native-web", "0.21.2");
  link(path.join(store, "react-native-web@0.21.2/node_modules/react"), "../../react@19.1.0/node_modules/react");
  link(path.join(nm, "react-native-web"), ".pnpm/react-native-web@0.21.2/node_modules/react-native-web");

  if (badReactForExpo) {
    pkg(path.join(store, "react@18.3.1/node_modules/react"), "react", "18.3.1");
    fs.rmSync(path.join(nm, "expo-modules-core"), { recursive: true, force: true });
    pkg(
      path.join(store, "expo-modules-core@3.0.30_react@18.3.1/node_modules/expo-modules-core"),
      "expo-modules-core",
      "3.0.30"
    );
    link(
      path.join(store, "expo-modules-core@3.0.30_react@18.3.1/node_modules/react"),
      "../../react@18.3.1/node_modules/react"
    );
    link(
      path.join(nm, "expo-modules-core"),
      ".pnpm/expo-modules-core@3.0.30_react@18.3.1/node_modules/expo-modules-core"
    );
  }

  const app = path.join(root, "apps/mobile");
  pkg(app, "mobile", "1.0.0", {
    dependencies: { react: "19.1.0", "react-dom": "19.1.0", "react-native": "0.81.5" },
  });
  fs.mkdirSync(path.join(app, "node_modules"), { recursive: true }); // empty — no app-local react
  return app;
}

/** Healthy isolated layout (default pnpm linker): app-local symlinks into .pnpm. */
function buildIsolated(root) {
  workspaceBase(root);
  const nm = path.join(root, "node_modules");
  const store = path.join(nm, ".pnpm");

  pkg(path.join(store, "react@19.1.0/node_modules/react"), "react", "19.1.0");
  pkg(path.join(store, "react-dom@19.1.0/node_modules/react-dom"), "react-dom", "19.1.0");
  link(path.join(store, "react-dom@19.1.0/node_modules/react"), "../../react@19.1.0/node_modules/react");
  pkg(path.join(store, "react-native@0.81.5/node_modules/react-native"), "react-native", "0.81.5");
  link(path.join(store, "react-native@0.81.5/node_modules/react"), "../../react@19.1.0/node_modules/react");
  pkg(path.join(store, "expo-modules-core@3.0.30/node_modules/expo-modules-core"), "expo-modules-core", "3.0.30");
  link(path.join(store, "expo-modules-core@3.0.30/node_modules/react"), "../../react@19.1.0/node_modules/react");
  pkg(path.join(store, "react-native-web@0.21.2/node_modules/react-native-web"), "react-native-web", "0.21.2");
  link(path.join(store, "react-native-web@0.21.2/node_modules/react"), "../../react@19.1.0/node_modules/react");

  const app = path.join(root, "apps/mobile");
  pkg(app, "mobile", "1.0.0", {
    dependencies: { react: "19.1.0", "react-dom": "19.1.0", "react-native": "0.81.5" },
  });
  const anm = path.join(app, "node_modules");
  link(path.join(anm, "react"), "../../../node_modules/.pnpm/react@19.1.0/node_modules/react");
  link(path.join(anm, "react-dom"), "../../../node_modules/.pnpm/react-dom@19.1.0/node_modules/react-dom");
  link(path.join(anm, "react-native"), "../../../node_modules/.pnpm/react-native@0.81.5/node_modules/react-native");
  link(path.join(anm, "expo-modules-core"), "../../../node_modules/.pnpm/expo-modules-core@3.0.30/node_modules/expo-modules-core");
  link(path.join(anm, "react-native-web"), "../../../node_modules/.pnpm/react-native-web@0.21.2/node_modules/react-native-web");
  return app;
}

// ----- tests -----------------------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supa-react-res-"));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

test("passes on a healthy hoisted install with NO app-local react copy", () => {
  const app = buildHoisted(path.join(tmpRoot, "hoisted"));
  const r = checkReactResolution(app);
  assert.deepStrictEqual(r.violations, [], JSON.stringify(r.violations, null, 2));
  assert.strictEqual(r.resolvedReactVersion, "19.1.0");
  assert.deepStrictEqual(r.reactVersionsInStore, ["19.1.0"]);
  for (const n of r.nativeGraph) assert.strictEqual(n.reactVersion, "19.1.0");
});

test("passes on a healthy isolated (default linker) install", () => {
  const app = buildIsolated(path.join(tmpRoot, "isolated"));
  const r = checkReactResolution(app);
  assert.deepStrictEqual(r.violations, [], JSON.stringify(r.violations, null, 2));
  assert.strictEqual(r.resolvedReactVersion, "19.1.0");
  assert.deepStrictEqual(r.reactVersionsInStore, ["19.1.0"]);
});

test("fails when a native package is keyed to a second React (the real hazard)", () => {
  const app = buildHoisted(path.join(tmpRoot, "dual"), { badReactForExpo: true });
  const r = checkReactResolution(app);
  assert.ok(r.violations.length >= 1, "expected at least one violation");
  // The native-graph mismatch is the load-bearing one.
  assert.ok(
    r.violations.some((v) => /keyed to a different React/.test(v.issue)),
    "expected a native-graph mismatch violation"
  );
  // And the duplicate-copy scan catches the second version too.
  assert.ok(
    r.violations.some((v) => /More than one React version/.test(v.issue)),
    "expected a duplicate-React violation"
  );
  assert.deepStrictEqual(r.reactVersionsInStore, ["18.3.1", "19.1.0"]);
  const expo = r.nativeGraph.find((n) => n.name === "expo-modules-core");
  assert.strictEqual(expo.reactVersion, "18.3.1");
});
