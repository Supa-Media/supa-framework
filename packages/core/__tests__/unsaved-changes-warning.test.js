"use strict";

/**
 * `SupaConvexProvider` must forward `unsavedChangesWarning` to the
 * `ConvexReactClient` it creates.
 *
 * Why: Convex's browser client attaches a `beforeunload` listener that asks
 * "Changes you made may not be saved" whenever any mutation **or action** is
 * still waiting on the server. An app that reads through actions gets that
 * prompt on nearly every reload with nothing unsaved (context.lc, 2026-09-26),
 * and the only switch is this constructor option — which the provider built
 * its client without.
 *
 * Structural, like `should-handle-code.test.js`: this suite has no DOM. The
 * behavioural pin lives in the consumer.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const BUILT = path.join(__dirname, "..", "dist", "providers", "ConvexProvider.js");

test("the built provider hands unsavedChangesWarning to the Convex client", () => {
  const source = fs.readFileSync(BUILT, "utf8");
  assert.match(
    source,
    /new ConvexReactClient\(\s*url,\s*unsavedChangesWarning === undefined \? undefined : \{ unsavedChangesWarning \}/,
    "the client is built without the option — an app can no longer turn off " +
      "Convex's reload prompt, and it fires for every in-flight read action",
  );
  assert.match(
    source,
    /getClient\(convexUrl, unsavedChangesWarning\)/,
    "unsavedChangesWarning is accepted but never passed to getClient",
  );
});
