/**
 * Evidence chips, parsed out of a merged PR's body.
 *
 * The overnight orchestrator is required to end every PR body with an
 * `## Evidence` section — the artefacts that prove the goal is actually done
 * rather than "looks done". The morning review renders that section as a row of
 * chips, so five overnight merges can be accepted or challenged in a glance
 * without opening five PRs.
 *
 * Convention (documented in README.md):
 *
 *     ## Evidence
 *
 *     - ![thread view](https://.../shot.png)
 *     - tests: 41 passing, 2 new
 *     - [staging deploy](https://github.com/.../runs/123)
 *     - manual: replied to a hidden thread on device
 *
 * Anything after the section's own heading and before the next heading of the
 * same or higher level is evidence. One bullet, one chip.
 */

export type EvidenceKind = "screenshot" | "test" | "link" | "note";

export interface EvidenceItem {
  kind: EvidenceKind;
  /** Chip text. Never the raw markdown. */
  label: string;
  /** Where the chip points, when the bullet carried a link. */
  url: string | null;
}

export interface Evidence {
  items: EvidenceItem[];
  /** Images across the whole section, so the row can lead with `📷 ×3`. */
  screenshotCount: number;
}

const EMPTY: Evidence = { items: [], screenshotCount: 0 };

/** `![alt](url)` — matched before links so an image is never read as a link. */
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
/** `[text](url)`. */
const LINK = /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g;

/**
 * The `## Evidence` section's raw text, or `null`.
 *
 * HTML comments go first: a PR template that ships the Evidence heading
 * commented out would otherwise register as a section full of instructions, and
 * every PR opened from the template would show fake evidence.
 */
export function evidenceSection(body: string): string | null {
  const text = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^(#{1,6})\s+evidence\b/i.exec(lines[i] as string);
    if (!heading) continue;

    const level = (heading[1] as string).length;
    const collected: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = /^(#{1,6})\s+/.exec(lines[j] as string);
      if (next && (next[1] as string).length <= level) break;
      collected.push(lines[j] as string);
    }
    return collected.join("\n");
  }
  return null;
}

/** Strip inline markdown down to the words a chip can show. */
function plain(markdown: string): string {
  return markdown
    .replace(IMAGE, (_all, alt: string) => alt || "screenshot")
    .replace(LINK, (_all, text: string) => text)
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(raw: string): EvidenceKind {
  if (IMAGE.test(raw)) {
    IMAGE.lastIndex = 0;
    return "screenshot";
  }
  IMAGE.lastIndex = 0;
  if (/\b(screenshot|screengrab|before\s*\/?\s*after|video|recording)\b/i.test(raw)) {
    return "screenshot";
  }
  if (/\b(tests?|suite|coverage|typecheck|lint|ci)\b/i.test(raw)) return "test";
  LINK.lastIndex = 0;
  if (LINK.test(raw)) {
    LINK.lastIndex = 0;
    return "link";
  }
  LINK.lastIndex = 0;
  return "note";
}

/**
 * `http(s)` only, for every branch below.
 *
 * A PR body is the one input on the review screen that the fleet's own tooling
 * did not author, and its chips become real `<a href>`s. Both layers happen to
 * block the interesting case already — React 19 rewrites a `javascript:` href to
 * a thrown error, and the page's `script-src 'self'` CSP blocks it
 * independently — but `data:` and `blob:` pass through both, the reasoning for
 * an allowlist was already written for the bare-URL branch three lines down, and
 * applying it to the markdown branches too costs one function. Hardening, not a
 * fix.
 */
function httpOnly(url: string | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function firstUrl(raw: string): string | null {
  IMAGE.lastIndex = 0;
  const image = IMAGE.exec(raw);
  IMAGE.lastIndex = 0;
  if (image) return httpOnly(image[2]);

  LINK.lastIndex = 0;
  const link = LINK.exec(raw);
  LINK.lastIndex = 0;
  if (link) return httpOnly(link[2]);

  // A URL sitting bare in the bullet still deserves to be clickable. Only
  // https — an `http://` chip on a page pinned to https would be a downgrade
  // the user never asked for.
  const bare = /https:\/\/[^\s)<>]+/.exec(raw);
  return bare ? bare[0] : null;
}

/** Count images across the section, including ones inside a single bullet. */
function countImages(section: string): number {
  IMAGE.lastIndex = 0;
  let count = 0;
  while (IMAGE.exec(section) !== null) count += 1;
  IMAGE.lastIndex = 0;
  return count;
}

/**
 * Parse a PR body into evidence chips. Never throws; a PR with no section (or a
 * section of prose) yields no items, which the UI shows as "no evidence" rather
 * than pretending the work was proven.
 */
export function parseEvidence(body: string | null | undefined): Evidence {
  if (typeof body !== "string" || body.trim() === "") return EMPTY;

  const section = evidenceSection(body);
  if (section === null) return EMPTY;

  const items: EvidenceItem[] = [];
  for (const line of section.split("\n")) {
    // Bullets and numbered items only. Prose under the heading is context for a
    // human reading the PR, not a claim to render as a chip.
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!bullet) continue;

    const raw = (bullet[1] as string).trim();
    if (raw === "") continue;

    const label = plain(raw);
    if (label === "") continue;

    items.push({ kind: classify(raw), label, url: firstUrl(raw) });
  }

  return { items, screenshotCount: countImages(section) };
}
