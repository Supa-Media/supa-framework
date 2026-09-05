/**
 * The guard on the guard.
 *
 * `check-core-isolation` is what keeps every other test file in this package —
 * and in every app built on it — able to run under plain `node` with nothing
 * installed. If it stops catching an Electron import, the split rots silently:
 * the first `import { dialog } from "electron"` in a reducer makes the suite
 * unloadable, and a suite that will not load reports no failures.
 *
 * So the last two checks point it at this package's own `src/core` and at the
 * whole package, and assert both answers: the core is clean, and the Electron
 * directory really does contain what the guard is looking for. Together those
 * say the check is running and is not vacuous.
 *
 * ## Sabotage record
 *
 *   `import { app } from "electron"` added to `src/core/tray.js`   the suite
 *       would not load at all: 0 PASS, 1 FAIL, no checks run
 *   the comment-stripping removed (JSDoc examples counted as imports)    1 failure
 *   subpath matching removed (`electron/main` allowed through)           1 failure
 *
 * The first line is the finding, not a formatting accident. In *this* package
 * Electron is not installed, so a core file that imports it takes the whole
 * suite down before a single check runs — which looks like one broken test
 * rather than a broken invariant. In a consuming app Electron *is* installed,
 * so the same import resolves happily and nothing fails at all until somebody
 * tries to run the core suite on CI without it. That is the case this bin
 * exists for, and it is why it is a separate command in the app's `test`
 * script rather than something inferred from a green run.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_FORBIDDEN, checkCoreIsolation } from "../src/index.js";

const root = mkdtempSync(join(tmpdir(), "supa-core-isolation-"));
test.after(() => rmSync(root, { recursive: true, force: true }));

function fixture(name, files) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, contents] of Object.entries(files)) {
    const path = join(dir, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
  return dir;
}

test("a clean core passes and says how much it read", () => {
  const dir = fixture("clean", {
    "settings.js": 'export const answer = 42;\nimport { join } from "node:path";\n',
    "nested/gate.ts": 'import { answer } from "../settings.js";\nexport const gate = () => answer;\n',
    "notes.md": "not a source file",
  });
  const result = checkCoreIsolation({ dirs: [dir] });
  assert.equal(result.ok, true);
  assert.equal(result.checked, 2, "the markdown file is not counted");
});

test("every way Electron can arrive is caught", () => {
  const dir = fixture("dirty", {
    "static.js": 'import { app } from "electron";\n',
    "dynamic.js": 'const later = await import("electron");\n',
    "required.cjs": 'const { dialog } = require("electron");\n',
    "subpath.ts": 'import { BrowserWindow } from "electron/main";\n',
  });
  const result = checkCoreIsolation({ dirs: [dir], cwd: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((v) => v.file).sort(),
    ["dynamic.js", "required.cjs", "static.js", "subpath.ts"],
  );
  assert.ok(result.violations.every((v) => v.line === 1));
});

test("THE RE-EXPORT COUNTS AS ELECTRON, BECAUSE IT IS ELECTRON", () => {
  // The first version of this check missed it: a core file importing
  // `createJsonStore` from `@supa-media/desktop/electron` pulls in the whole
  // runtime just as surely as one importing `app`, and it reads as a Supa
  // import rather than an Electron one.
  const dir = fixture("reexport", {
    "store.js": 'import { createJsonStore } from "@supa-media/desktop/electron";\n',
    "fine.js": 'import { defineOutbox } from "@supa-media/desktop";\n',
  });
  assert.deepEqual(DEFAULT_FORBIDDEN, ["electron", "@supa-media/desktop/electron"]);
  const result = checkCoreIsolation({ dirs: [dir], cwd: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((v) => v.file), ["store.js"]);
});

test("a type-only import counts, because it is how the dependency comes back", () => {
  const dir = fixture("types", { "view.ts": '\nimport type { Rectangle } from "electron";\n' });
  const result = checkCoreIsolation({ dirs: [dir], cwd: dir });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].line, 2, "the reported line is the real one");
});

test("documentation is not a dependency", () => {
  // A JSDoc `@example` that shows the Electron side of an API must not fail the
  // check, or the guard becomes something people turn off.
  const dir = fixture("docs", {
    "tray.js": [
      "/**",
      " * @example",
      " * ```js",
      ' * import { Tray } from "electron";',
      " * ```",
      " */",
      '// see also: require("electron")',
      "export const tray = 1;",
    ].join("\n"),
  });
  assert.equal(checkCoreIsolation({ dirs: [dir] }).ok, true);
});

test("extra forbidden modules can be named, and node_modules is skipped", () => {
  const dir = fixture("extra", {
    "a.js": 'import Store from "electron-store";\n',
    "node_modules/pkg/index.js": 'import { app } from "electron";\n',
  });
  assert.equal(checkCoreIsolation({ dirs: [dir] }).ok, true, "electron-store is not electron");
  const strict = checkCoreIsolation({ dirs: [dir], forbidden: ["electron", "electron-store"], cwd: dir });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.violations.map((v) => v.file), ["a.js"]);
});

test("a missing directory is an error rather than a silent pass", () => {
  assert.throws(() => checkCoreIsolation({ dirs: [join(root, "nope")] }), /does not exist/);
});

test("THIS PACKAGE'S OWN CORE IS ELECTRON-FREE", () => {
  const core = new URL("../src/core", import.meta.url).pathname;
  const result = checkCoreIsolation({ dirs: [core] });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.ok(result.checked >= 8, "and the check actually read the files");
});

test("...and the check is not vacuous — the Electron half really does import it", () => {
  const electron = new URL("../src/electron", import.meta.url).pathname;
  const result = checkCoreIsolation({ dirs: [electron] });
  assert.equal(result.ok, false, "if this passes, the checker has stopped working");
});
