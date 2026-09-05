/**
 * JSON files in `app.getPath("userData")`, written atomically.
 *
 * Two rules, both of which exist because the interesting file here is not the
 * settings file but the queue beside it, which holds work that has not reached
 * a server yet:
 *
 * **Writes are atomic.** Write a temporary file, `fsync` it, then rename. A
 * power cut halfway through writing a long queue must not leave a truncated
 * JSON file where the queue used to be; rename is the only operation a
 * filesystem promises not to tear, and without the flush the rename can land
 * before the bytes do.
 *
 * **A read never throws.** Whatever comes back — nothing, half a file, a hand
 * edit — is handed to the `normalize` function the caller supplied, which is
 * `defineSettings(...).normalize` or `defineOutbox(...).normalize`. See their
 * headers for what "repair" is allowed to mean; for settings it is deliberately
 * *not* "keep going with whatever parsed".
 *
 * Files are written `0600`. They contain no credential — that is the keychain's
 * job, see `./tokenStore.js` — but they do contain the app's own record of what
 * a person did, and on a shared machine that is nobody else's business.
 */

import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  // Without this the rename can be durable before its contents are, which is
  // the crash that leaves a zero-length file where the queue was.
  const handle = await open(temporary, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

/**
 * A directory of normalised JSON documents.
 *
 * @example
 * ```js
 * const store = createJsonStore(app.getPath("userData"), {
 *   settings: { file: "settings.json", normalize: settings.normalize },
 *   outbox: { file: "outbox.json", normalize: outbox.normalize },
 * });
 *
 * let current = await store.read("settings");
 * await store.write("settings", { ...current, theme: "dark" });
 * ```
 *
 * @param {string} dir
 * @param {Record<string, { file: string, normalize: (raw: unknown) => any }>} documents
 */
export function createJsonStore(dir, documents) {
  const documentFor = (key) => {
    const document = documents[key];
    if (!document) throw new Error(`no document named ${JSON.stringify(key)} in this store`);
    return document;
  };
  const pathFor = (key) => join(dir, documentFor(key).file);

  return {
    dir,
    pathFor,
    /** Read and repair. Never throws for a missing, truncated or hostile file. */
    async read(key) {
      const document = documentFor(key);
      return document.normalize(await readJson(join(dir, document.file)));
    },
    /** Replace, atomically. */
    async write(key, value) {
      await writeJson(pathFor(key), value);
    },
  };
}
