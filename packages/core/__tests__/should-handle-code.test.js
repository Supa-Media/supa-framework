"use strict";

/**
 * `SupaConvexProvider` must forward `shouldHandleCode` to `ConvexAuthProvider`.
 *
 * Why this matters enough to pin: left unforwarded, `ConvexAuthProvider`
 * treats every `?code=` URL parameter on every route as a sign-in code. For
 * an app with any other OAuth callback (Dropbox, Google, GitHub redirect
 * back with `?code=`), the auth provider redeems the foreign code as a login
 * code, verification returns `tokens: null`, and the client **stores the
 * sign-out** — wiping a working session on every storage connect. Found live
 * on context.lc, 2026-08-28: reconnecting Dropbox logged the owner out,
 * deterministically, until the app could scope code-handling away from
 * `/connect/*`.
 *
 * No renderer here (this package's suite is node --test, no DOM), so this is
 * a structural check against the built output: the prop is accepted and the
 * JSX spread hands it to the auth provider. The behavioral pin lives in the
 * consumer (context.lc's layout test), where a DOM exists.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const BUILT = path.join(__dirname, "..", "dist", "providers", "ConvexProvider.js");

test("the built provider accepts and forwards shouldHandleCode", () => {
  const source = fs.readFileSync(BUILT, "utf8");
  assert.match(
    source,
    /shouldHandleCode/,
    "shouldHandleCode is gone from the built provider — ConvexAuthProvider will " +
      "again eat every OAuth callback's ?code= as a login code and store the sign-out",
  );
  // The prop must reach the ConvexAuthProvider element, not just exist in the
  // props interface. The compiled JSX passes it in the createElement props
  // object; both the prop name appearing twice (destructure + forward) and
  // its adjacency to the other forwarded props hold in the tsc output.
  const forwards = source.match(/shouldHandleCode/g) ?? [];
  assert.ok(
    forwards.length >= 2,
    "shouldHandleCode is destructured but never forwarded to ConvexAuthProvider",
  );
});
