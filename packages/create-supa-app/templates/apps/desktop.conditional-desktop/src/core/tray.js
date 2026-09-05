/**
 * What the menu bar says, as a pure function of what the app is doing.
 *
 * A state declares `capturing` and cannot declare `indicator`: the always-on
 * indicator is derived, so a state that is doing something privileged with no
 * sign of it on screen is not something you can write here. If this app ever
 * opens a microphone, a camera or the screen, mark that state `capturing: true`
 * and the menu bar tells the truth for free.
 */

import { defineTray, formatElapsed } from "@supa-media/desktop";

export const tray = defineTray({
  states: {
    idle: { icon: "idle", tooltip: () => "{{APP_NAME}} — paused" },
    watching: { icon: "watching", tooltip: () => "{{APP_NAME}} — watching" },
    working: {
      icon: "working",
      capturing: true,
      title: (input) => formatElapsed(input.elapsedMs ?? 0),
      tooltip: () => "{{APP_NAME}} — working",
    },
  },
  suffix: (input) => (input.pending ? ` · ${input.pending} waiting to sync` : ""),
});
