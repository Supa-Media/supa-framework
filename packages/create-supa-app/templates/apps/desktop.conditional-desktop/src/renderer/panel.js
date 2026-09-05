/**
 * The panel: renders pushed state, sends verbs, decides nothing.
 *
 * Everything on screen arrives through `window.desktop.onState`. There is no
 * fetch here, no storage, and no copy of the settings — a renderer that keeps
 * its own idea of the truth is a renderer that disagrees with the menu bar.
 */

const status = document.querySelector("[data-status]");
const toggle = document.querySelector("[data-toggle]");

window.desktop.onState((state) => {
  status.textContent = state.tray.tooltip;
  toggle.textContent = state.settings.watching ? "Pause" : "Start watching";
  toggle.dataset.on = String(state.settings.watching);
  // Rendered as text, never as HTML: this string can contain a window title or
  // a filename somebody else chose.
  document.body.dataset.state = state.tray.state;
});

toggle.addEventListener("click", () => {
  window.desktop.setWatching(toggle.dataset.on !== "true");
});

document.querySelector("[data-quit]").addEventListener("click", () => window.desktop.quit());
