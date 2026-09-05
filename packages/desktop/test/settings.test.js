/**
 * A settings file never widens what a desktop app may do.
 *
 * Every case below is one shape of broken record, asserted to land on the
 * *safe* value rather than on a plausible one. The interesting direction is
 * always the same: a file that fails to say "ask me first" must still ask.
 *
 * ## Sabotage record
 *
 * Run as a temporary local edit and reverted:
 *
 *   `boolField` reading `Boolean(value)` instead of falling back        4 failures
 *   sticky fields dropped on a version mismatch                         1 failure
 *   `acceptableEndpointUrl` allowing credentials in the URL             1 failure
 *
 * The first is why `boolField` takes a fallback at all: `Boolean(undefined)` is
 * `false`, and `false` for "ask every time" is an app that acts without asking.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptableEndpointUrl,
  boolField,
  defineSettings,
  endpointField,
  enumField,
  stringField,
  stringListField,
} from "../src/index.js";

const settings = defineSettings({
  version: 1,
  fields: {
    watchEnabled: boolField(false),
    captureEnabled: boolField(false),
    askEveryTime: boolField(true),
    denylist: stringListField({ sticky: true }),
    engine: enumField(["on-device", "cloud"], "on-device"),
    endpoint: endpointField(),
    deviceName: stringField(),
  },
});

test("a missing or unreadable file resolves to the safe state", () => {
  for (const raw of [undefined, null, "not an object", 7, []]) {
    const resolved = settings.normalize(raw);
    assert.equal(resolved.askEveryTime, true, `askEveryTime for ${JSON.stringify(raw)}`);
    assert.equal(resolved.captureEnabled, false);
    assert.equal(resolved.watchEnabled, false);
    assert.equal(resolved.engine, "on-device");
    assert.deepEqual(resolved.denylist, []);
  }
});

test("a truthy non-boolean does not read as consent", () => {
  // `"no"` is a truthy string. Coercion would turn a plain-English refusal into
  // an app that never asks again.
  assert.equal(settings.normalize({ version: 1, askEveryTime: "no" }).askEveryTime, true);
  assert.equal(settings.normalize({ version: 1, askEveryTime: 0 }).askEveryTime, true);
  assert.equal(settings.normalize({ version: 1, captureEnabled: "yes" }).captureEnabled, false);
});

test("an absent field falls back to its safe value, not to its coercion", () => {
  const resolved = settings.normalize({ version: 1, captureEnabled: true });
  assert.equal(resolved.askEveryTime, true);
  assert.equal(resolved.captureEnabled, true);
});

test("a denylist outlives the schema it was written in", () => {
  const future = settings.normalize({ version: 99, denylist: ["Therapy App", "zoom"], captureEnabled: true });
  assert.deepEqual(future.denylist, ["Therapy App", "zoom"]);
  // ...and nothing else from an unreadable version is trusted.
  assert.equal(future.captureEnabled, false);
  assert.equal(future.askEveryTime, true);
});

test("denylist entries are trimmed, deduplicated and stripped of rubbish", () => {
  const dirty = settings.normalize({ version: 1, denylist: ["zoom", "zoom", 7, "", "  ", " teams "] });
  assert.deepEqual(dirty.denylist, ["zoom", "teams"]);
});

test("a version mismatch hands back a fresh list, not the shared default", () => {
  const a = settings.normalize({ version: 99 });
  const b = settings.normalize({ version: 99 });
  a.denylist.push("mutated");
  assert.deepEqual(b.denylist, [], "one caller's push must not reach the next caller");
  assert.deepEqual(settings.defaults.denylist, []);
});

test("the exported defaults cannot be edited into something unsafe", () => {
  assert.throws(() => {
    settings.defaults.captureEnabled = true;
  }, TypeError);
  assert.throws(() => {
    settings.defaults.denylist.push("anything");
  }, TypeError);
});

test("an enum falls back rather than passing an unknown value through", () => {
  assert.equal(settings.normalize({ version: 1, engine: "cloud" }).engine, "cloud");
  assert.equal(settings.normalize({ version: 1, engine: "whatever" }).engine, "on-device");
  assert.equal(settings.normalize({ version: 1, engine: 3 }).engine, "on-device");
});

test("enumField refuses a fallback that is not one of its own values", () => {
  assert.throws(() => enumField(["a", "b"], "c"), /not one of/);
});

test("no unknown field survives normalisation", () => {
  const resolved = settings.normalize({ version: 1, token: "shhh", extra: true });
  assert.equal("token" in resolved, false, "a credential must not survive a round trip through settings");
  assert.equal("extra" in resolved, false);
  assert.deepEqual(Object.keys(resolved).sort(), ["askEveryTime", "captureEnabled", "denylist", "deviceName", "endpoint", "engine", "version", "watchEnabled"]);
});

test("an endpoint is https, or loopback http, and never carries a credential", () => {
  assert.equal(acceptableEndpointUrl("https://api.example.test"), "https://api.example.test");
  assert.equal(acceptableEndpointUrl("https://api.example.test/"), "https://api.example.test");
  assert.equal(acceptableEndpointUrl("https://api.example.test/v1/"), "https://api.example.test/v1");
  assert.equal(acceptableEndpointUrl("  https://api.example.test  "), "https://api.example.test");

  assert.equal(acceptableEndpointUrl("http://api.example.test"), null, "plain http on the network");
  assert.equal(acceptableEndpointUrl("http://localhost:8787"), "http://localhost:8787", "self-hosting");
  assert.equal(acceptableEndpointUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(acceptableEndpointUrl("http://localhost:8787", { allowLoopbackHttp: false }), null);

  assert.equal(acceptableEndpointUrl("https://user:secret@api.example.test"), null, "credentials in the URL");
  assert.equal(acceptableEndpointUrl("https://user@api.example.test"), null);
  assert.equal(acceptableEndpointUrl("file:///etc/passwd"), null);
  assert.equal(acceptableEndpointUrl("api.example.test"), null, "not a URL at all");
  assert.equal(acceptableEndpointUrl(""), null);
  assert.equal(acceptableEndpointUrl(undefined), null);
});

test("defineSettings refuses a version that is not an integer", () => {
  assert.throws(() => defineSettings({ version: "1", fields: {} }), /integer version/);
});
