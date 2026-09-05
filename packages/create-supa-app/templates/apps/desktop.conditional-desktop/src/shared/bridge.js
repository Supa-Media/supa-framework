/**
 * The whole surface a window has, declared once.
 *
 * Imported by the preload (which exposes it as `window.desktop`) and by
 * the main process (which registers a handler for every command). Keeping it in
 * one file is what makes "what can a renderer do?" a question you answer by
 * reading eight lines rather than by grepping for `send`.
 *
 * There is no request/response direction on purpose. A command is
 * fire-and-forget and the answer arrives as the next `state` push, so there is
 * no channel a renderer could call to *read* anything — which is how "the
 * renderer cannot get at the credential" stays true without anyone having to
 * remember it.
 */

import { defineBridge } from "@supa-media/desktop/electron";

export const bridge = defineBridge({
  // A fixed, obviously-valid identifier rather than the app slug: a slug is
  // kebab-case and `window.my-app` is not a thing.
  name: "desktop",
  channels: ["state"],
  commands: ["setWatching", "openSettings", "quit"],
});
