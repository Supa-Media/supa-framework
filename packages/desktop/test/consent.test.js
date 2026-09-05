/**
 * Nothing captures without a yes, and a no lasts as long as the thing it was
 * said about.
 *
 * The cases below are the ones that decide whether an app is tolerable to live
 * with: a poll loop that re-asks every five seconds, a grant that follows a
 * person to a different app, and a denylist entry added after a yes.
 *
 * ## Sabotage record
 *
 *   the denylist check moved below `captureEnabled`                     1 failure
 *   the denylist check removed from the gate entirely                   2 failures
 *   a decline that does not stick                                       1 failure
 *   `askEveryTime` ignored, so every episode starts rather than asks    3 failures
 */

import test from "node:test";
import assert from "node:assert/strict";
import { IDLE_CONSENT, answered, asked, decideConsent, episodeKey, forgetEpisode } from "../src/index.js";

const base = {
  consent: IDLE_CONSENT,
  denied: false,
  captureEnabled: true,
  askEveryTime: true,
  busy: false,
};

test("nothing happens without an episode", () => {
  assert.deepEqual(decideConsent({ ...base, episode: null }), { kind: "hold", why: "no-episode" });
  assert.deepEqual(decideConsent({ ...base, episode: undefined }), { kind: "hold", why: "no-episode" });
});

test("an episode raises the prompt and captures nothing yet", () => {
  assert.deepEqual(decideConsent({ ...base, episode: "e1" }), { kind: "ask", episode: "e1" });
});

test("consent given once in advance starts without asking again", () => {
  assert.deepEqual(decideConsent({ ...base, episode: "e1", askEveryTime: false }), { kind: "start", episode: "e1" });
});

test("capture disabled is a full stop that a pre-authorisation cannot talk past", () => {
  assert.deepEqual(decideConsent({ ...base, episode: "e1", askEveryTime: false, captureEnabled: false }), {
    kind: "hold",
    why: "capture-disabled",
  });
  assert.deepEqual(
    decideConsent({ ...base, episode: "e1", captureEnabled: false, consent: answered("e1", "granted") }),
    { kind: "hold", why: "capture-disabled" },
  );
});

test("THE DENYLIST BEATS AN EXPLICIT YES", () => {
  // The reason this is checked at the gate as well as before observation: a
  // subject can arrive by a route that never passed through the filter, and a
  // grant recorded before an entry was added must not outlive it.
  assert.deepEqual(decideConsent({ ...base, episode: "e1", denied: true, consent: answered("e1", "granted") }), {
    kind: "hold",
    why: "denied",
  });
  assert.deepEqual(decideConsent({ ...base, episode: "e1", denied: true, askEveryTime: false }), {
    kind: "hold",
    why: "denied",
  });
});

test("a denial is reported as itself, not as the general refusal", () => {
  // Ordered before `captureEnabled` so a person reads the specific reason they
  // configured rather than a switch they did not touch.
  const both = decideConsent({ ...base, episode: "e1", denied: true, captureEnabled: false });
  assert.deepEqual(both, { kind: "hold", why: "denied" });
});

test("A DECLINE IS STICKY FOR THAT EPISODE", () => {
  // A watcher polls; if a decline lasted one poll, "Not now" would mean "ask me
  // again in five seconds, forever", and a person would press yes to make it
  // stop. Fifty polls, one answer.
  let consent = answered("e1", "declined");
  for (let poll = 0; poll < 50; poll += 1) {
    assert.deepEqual(decideConsent({ ...base, episode: "e1", consent }), {
      kind: "hold",
      why: "declined-this-episode",
    });
  }
  // ...and a genuinely new episode asks again.
  assert.deepEqual(decideConsent({ ...base, episode: "e2", consent }), { kind: "ask", episode: "e2" });
});

test("a prompt already up is not raised a second time", () => {
  assert.deepEqual(decideConsent({ ...base, episode: "e1", consent: asked("e1") }), {
    kind: "hold",
    why: "already-asking",
  });
});

test("a grant starts, and a second capture never does", () => {
  assert.deepEqual(decideConsent({ ...base, episode: "e1", consent: answered("e1", "granted") }), {
    kind: "start",
    episode: "e1",
  });
  assert.deepEqual(decideConsent({ ...base, episode: "e1", consent: answered("e1", "granted"), busy: true }), {
    kind: "hold",
    why: "already-capturing",
  });
});

test("a grant does not follow a person to a different episode", () => {
  const consent = answered("e1", "granted");
  assert.deepEqual(decideConsent({ ...base, episode: "e2", consent }), { kind: "ask", episode: "e2" });
});

test("episode keys separate two activations and join fifty polls of one", () => {
  const zoomAt10 = { active: true, since: "2026-09-05T10:00:00.000Z", source: { kind: "call", app: "zoom.us" } };
  const zoomAt11 = { active: true, since: "2026-09-05T11:00:00.000Z", source: { kind: "call", app: "zoom.us" } };
  const meetAt10 = { active: true, since: "2026-09-05T10:00:00.000Z", source: { kind: "call", app: "meet" } };

  assert.equal(episodeKey(zoomAt10), episodeKey({ ...zoomAt10 }), "the same activation is one episode");
  assert.notEqual(episodeKey(zoomAt10), episodeKey(zoomAt11), "two calls in the same app are two episodes");
  assert.notEqual(episodeKey(zoomAt10), episodeKey(meetAt10), "switching app mid-episode is a new decision");

  assert.equal(episodeKey({ active: false, since: "x", source: null }), null);
  assert.equal(episodeKey({ active: true, since: null, source: null }), null);
  assert.equal(episodeKey(null), null);
  assert.equal(episodeKey(undefined), null);
});

test("forgetting is scoped to the episode it names", () => {
  const consent = answered("e1", "granted");
  assert.deepEqual(forgetEpisode(consent, "e1"), IDLE_CONSENT);
  assert.deepEqual(forgetEpisode(consent, "e2"), consent, "a stale clear must not wipe a fresh grant");
  assert.deepEqual(forgetEpisode(IDLE_CONSENT, null), IDLE_CONSENT);
});

test("the gate keeps one decision and no history", () => {
  // A record of everything somebody declined to have captured is itself a
  // surveillance log. The state has room for exactly one episode.
  assert.deepEqual(Object.keys(answered("e1", "declined")).sort(), ["decision", "episode"]);
});
