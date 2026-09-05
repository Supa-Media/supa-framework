/**
 * The real credential store: Electron's `safeStorage` over the OS keychain.
 *
 * `safeStorage` encrypts with a key held by the operating system — the Keychain
 * on macOS, DPAPI on Windows, and libsecret/kwallet on Linux. The ciphertext is
 * what lands on disk, so the app's own data directory holds nothing usable, and
 * a copied backup or a synced folder carries nothing usable either.
 *
 * ## It refuses rather than degrades
 *
 * `safeStorage.isEncryptionAvailable()` is false on a Linux session with no
 * keyring, and the tempting fallback — write the token to a file with `0600` and
 * carry on — is exactly the thing this store exists to prevent. So `write`
 * throws, `encrypted` is false, and the app is expected to say so: "this machine
 * has no secure storage, so it will stay disconnected" is an honest state, and
 * a plaintext token in a dotfile is not.
 *
 * ## It is never reachable from a renderer
 *
 * Nothing here is exposed through `defineBridge`. A renderer asks the main
 * process to send something; the main process attaches the header
 * (`core/client.js`). A token that reaches a renderer is a token in a web page.
 */

import { safeStorage } from "electron";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * @param {{ file: string }} options path to the ciphertext file, e.g.
 *   `join(app.getPath("userData"), "credential.bin")`
 * @returns {import("../core/tokenStore.js").TokenStore}
 */
export function safeStorageTokenStore(options) {
  const { file } = options;
  const encrypted = safeStorage.isEncryptionAvailable();

  return {
    encrypted,

    async read() {
      if (!encrypted) return null;
      let ciphertext;
      try {
        ciphertext = await readFile(file);
      } catch {
        return null;
      }
      try {
        const token = safeStorage.decryptString(ciphertext);
        return token === "" ? null : token;
      } catch {
        // The keychain entry was rotated, the file was copied from another
        // machine, or the bytes are not ours. Not an error worth crashing on —
        // it means the same thing as "not connected", and the reconnect flow is
        // the fix.
        return null;
      }
    },

    async write(token) {
      if (!encrypted) {
        throw new Error(
          "this machine offers no encrypted storage (no keyring), so no credential will be stored — connect on a machine that has one",
        );
      }
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await writeFile(temporary, safeStorage.encryptString(token), { mode: 0o600 });
      // Belt and braces: `writeFile`'s mode applies only when it creates the
      // file, so a leftover temporary from a previous run could be looser.
      await chmod(temporary, 0o600);
      await rename(temporary, file);
    },

    async clear() {
      await rm(file, { force: true });
    },
  };
}
