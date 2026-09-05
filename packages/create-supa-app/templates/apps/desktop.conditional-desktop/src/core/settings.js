/**
 * What this app remembers between launches.
 *
 * `normalize` never throws and repairs anything — a missing file, a truncated
 * one, a hand edit, a record from a newer build — onto the *safe* value for
 * every field it cannot read. Add fields here; the store in `main/index.js`
 * needs no change.
 *
 * No credential lives in this file. If this app grows a server to talk to, the
 * token goes in `safeStorageTokenStore` (the OS keychain), never here.
 */

import { boolField, defineSettings, endpointField, stringListField } from "@supa-media/desktop";

export const settings = defineSettings({
  version: 1,
  fields: {
    /** Whether the app does its work at all. Off is the safe resting state. */
    watching: boolField(false),
    /** Start when the person logs in. */
    launchAtLogin: boolField(false),
    /**
     * Apps this one leaves alone. `sticky: true` means it survives a record
     * written by a version this build does not understand — dropping a list of
     * things you were told not to touch is the one repair that is never safe.
     */
    denylist: stringListField({ sticky: true }),
    /** https only, no credentials in the URL, loopback http for self-hosting. */
    endpoint: endpointField(),
  },
});
