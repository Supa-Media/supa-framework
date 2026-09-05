/**
 * Where a desktop app's credential lives, which is nowhere it can leak it.
 *
 * A desktop app has to hold *something* to authenticate, so the rule becomes:
 * the OS keychain holds it, encrypted by the OS, and nothing else on the machine
 * ever sees it in plaintext at rest. The real store is
 * `safeStorageTokenStore` in `@supa-media/desktop/electron`; this module is the
 * interface it satisfies and the in-memory one everything else runs against.
 *
 * Two consequences are enforced by the shape rather than remembered:
 *
 *  - **The token is never returned to a renderer.** Nothing in this interface
 *    is reachable from a preload bridge (`../electron/bridge.js` exposes named
 *    commands, and `read` is not one anybody should name). The renderer asks
 *    the main process to send; the main process attaches the header. A token in
 *    a renderer is a token in a web page.
 *  - **The token is never part of a URL.** Routes are paths and the credential
 *    is a header — see `./client.js`, which is the only thing that reads it.
 *
 * `encrypted` is false when the OS refused to give us encrypted storage: a
 * Linux session with no keyring, most often. An app should then refuse to store
 * a token at all rather than fall back to a file, and say so — see the Electron
 * store, which does exactly that.
 *
 * @typedef {object} TokenStore
 * @property {() => Promise<string | null>} read the bearer token, or `null` when this machine is not connected
 * @property {(token: string) => Promise<void>} write
 * @property {() => Promise<void>} clear must leave nothing a later read could find
 * @property {boolean} encrypted false when the OS has no encrypted storage to offer
 */

/**
 * In memory, for tests and for `--dev`. Never persisted, and says so.
 *
 * @param {string | null} [initial]
 * @returns {TokenStore}
 */
export function memoryTokenStore(initial = null) {
  let token = initial;
  return {
    encrypted: false,
    async read() {
      return token;
    },
    async write(next) {
      token = next;
    },
    async clear() {
      token = null;
    },
  };
}
