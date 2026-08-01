/**
 * The fleet: which repos an inbox item can be routed to, and the domain
 * vocabulary that identifies each one.
 *
 * The repo list deliberately duplicates `packages/fleet-dashboard`'s
 * `src/fleet.config.ts` rather than importing it. That package is a private
 * Vite app with no `exports` map — importing it would mean publishing an app as
 * a library to share four strings. If a repo joins or leaves the fleet, update
 * both files.
 *
 * `vocabulary` is the routing heuristic's entire input. Terms are matched
 * case-insensitively on word boundaries, so multi-word entries ("run sheet")
 * work as written. Two rules keep the heuristic honest:
 *
 *  - **Shared words are omitted, not shared.** "event" belongs to events-os
 *    (event operations is its whole domain) even though Togather has events
 *    too; Togather is recognized by "community", "prayer", "rsvp", "group".
 *    A term in two lists produces a tie, and a tie routes to `unassigned` —
 *    which is correct but useless, so prefer the discriminating word.
 *  - **`unassigned` is a real outcome, not a failure.** An item that doesn't
 *    clearly belong somewhere gets filed for the owner to place, rather than
 *    guessed into the wrong repo.
 */

export interface FleetApp {
  /** Stable short id. Appears in callback data and in the model's `app` field. */
  key: string;
  /** `owner/name` exactly as GitHub spells it. */
  slug: string;
  /** Human label for the Telegram summary. */
  label: string;
  /** Domain words that identify this app. Lowercase; word-boundary matched. */
  vocabulary: string[];
}

/** The routing outcome for anything ambiguous or unrecognized. */
export const UNASSIGNED = "unassigned";

/**
 * Where an `unassigned` item is filed. It has to land somewhere the owner will
 * see it, and the framework repo is the fleet's own workshop.
 */
export const UNASSIGNED_SLUG = "Supa-Media/supa-framework";

export const FLEET_APPS: readonly FleetApp[] = [
  {
    key: "togather",
    slug: "togathernyc/togather",
    label: "Togather",
    vocabulary: [
      "togather",
      "church",
      "community",
      "congregation",
      "group",
      "small group",
      "chat",
      "thread",
      "message",
      "announcement",
      "prayer",
      "rsvp",
      "serving",
      "explore",
      "member",
      "push notification",
    ],
  },
  {
    key: "events-os",
    slug: "Supa-Media/events-os",
    label: "Events OS",
    vocabulary: [
      "events os",
      "event",
      "run sheet",
      "roster",
      "rostering",
      "volunteer",
      "budget",
      "finance",
      "chapter",
      "vendor",
      "expense",
      "transaction",
      "org chart",
      "seat",
      "academy",
      "venue",
      "site map",
      "supplies",
      "people",
      "form",
    ],
  },
  {
    key: "fount",
    slug: "shyoh/fount-studios",
    label: "Fount Studios",
    vocabulary: ["fount", "studios", "worship", "artist", "release", "song"],
  },
  {
    key: "framework",
    slug: "Supa-Media/supa-framework",
    label: "Supa Framework",
    vocabulary: [
      "framework",
      "supa framework",
      "package",
      "scaffold",
      "monorepo",
      "reusable workflow",
      "secrets sync",
      "changeset",
      "publish",
      "gardener",
      "dashboard",
      "adr",
    ],
  },
];

/** The app with this key, or `null` for an unknown key (including `unassigned`). */
export function appByKey(key: string): FleetApp | null {
  return FLEET_APPS.find((app) => app.key === key) ?? null;
}

/** The repo an item with this app key is filed into. */
export function slugForApp(key: string): string {
  return appByKey(key)?.slug ?? UNASSIGNED_SLUG;
}

/** Display label for an app key, including the `unassigned` pseudo-app. */
export function labelForApp(key: string): string {
  return appByKey(key)?.label ?? "Unassigned";
}
