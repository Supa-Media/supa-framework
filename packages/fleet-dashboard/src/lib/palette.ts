import type { ViewId } from "../views/context";

/**
 * The ⌘K palette's model, as pure data.
 *
 * It lives here rather than inside the component because the one rule that
 * matters is a rule about *what a keystroke may do*, and a rule like that should
 * be testable without a DOM:
 *
 *   **↵ on a typed query navigates. It never writes.**
 *
 * The first version of this palette pushed `File issue → <repo>` to the top of
 * the list whenever the query was non-empty and reset the cursor to 0 on every
 * keystroke — so following the Copilot view's own instruction ("type a view name
 * and press ↵") filed a live `agent:ready` issue titled `queue` that the
 * overnight orchestrator then picked up as real work. There was no confirm step
 * anywhere on that path.
 *
 * The fix is two rules, both enforced below and both covered by
 * `test/palette.test.ts`:
 *
 *   1. `initialCursor` only ever points at a **navigation** option. When nothing
 *      matches the query, it points at nothing and ↵ does nothing. A write can
 *      only become the highlighted row if the user arrows or hovers onto it.
 *   2. A write is a **two-step**: the first activation *stages* it, which renders
 *      a confirm row naming the repo, the labels, and the title; only a second
 *      ↵ (or a click on "file it") commits. `resolveEnter` is the whole of that
 *      state machine.
 */

/** A jump target — one nav entry per view, plus one per app. */
export interface NavTarget {
  id: ViewId;
  label: string;
}

/** Exactly what a staged write will do, so the confirm row can state it. */
export interface PaletteWrite {
  /** `issue` files queued work; `dump` files a raw inbox item. */
  intent: "issue" | "dump";
  repoSlug: string;
  repoLabel: string;
  title: string;
  body: string;
  labels: string[];
  /** Where to go after the write lands, or `null` to stay put. */
  thenNavigate: ViewId | null;
}

export type PaletteOption =
  | { id: string; kind: "nav"; label: string; hint: string; view: ViewId }
  | { id: string; kind: "link"; label: string; hint: string; url: string }
  | { id: string; kind: "write"; label: string; hint: string; write: PaletteWrite };

export interface PaletteInput {
  query: string;
  views: readonly NavTarget[];
  repos: readonly { slug: string; label: string }[];
  claudeCodeUrl: string;
  /** `agent:ready` — the label a filed issue carries. */
  readyLabel: string;
  /** `inbox:raw` — the label a saved dump carries. */
  rawLabel: string;
}

/** GitHub issue titles are one line; a pasted paragraph becomes its own body. */
export function issueTitle(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}

/**
 * The option list for a query, in the order it renders.
 *
 * Navigation first — always, and regardless of whether the query looks like a
 * sentence. Writes are last precisely so that the row ↵ acts on is never one.
 */
export function buildPaletteOptions(input: PaletteInput): PaletteOption[] {
  const text = input.query.trim();
  const needle = text.toLowerCase();
  const list: PaletteOption[] = [];

  for (const view of input.views) {
    if (needle !== "" && !view.label.toLowerCase().includes(needle)) continue;
    list.push({
      id: `nav:${view.id}`,
      kind: "nav",
      label: `Go to ${view.label}`,
      hint: "jump",
      view: view.id,
    });
  }

  list.push({
    id: "claude",
    kind: "link",
    label: "Open Claude Code",
    hint: "new tab",
    url: input.claudeCodeUrl,
  });

  if (text !== "") {
    const title = issueTitle(text);
    for (const repo of input.repos) {
      list.push({
        id: `issue:${repo.slug}`,
        kind: "write",
        label: `File issue → ${repo.label}`,
        hint: "confirm first",
        write: {
          intent: "issue",
          repoSlug: repo.slug,
          repoLabel: repo.label,
          title,
          body: `${text}\n\n_Filed from the fleet dashboard palette._`,
          labels: [input.readyLabel],
          thenNavigate: null,
        },
      });
    }

    const first = input.repos[0];
    if (first !== undefined) {
      list.push({
        id: "dump",
        kind: "write",
        label: `Save to inbox as a dump → ${first.label}`,
        hint: "confirm first",
        write: {
          intent: "dump",
          repoSlug: first.slug,
          repoLabel: first.label,
          title,
          body: text,
          labels: [input.rawLabel],
          thenNavigate: "inbox",
        },
      });
    }
  }

  return list;
}

/**
 * The row ↵ acts on before the user moves: the first **navigation** option, or
 * `-1` when the query matches no view.
 *
 * `-1` is a deliberate outcome, not a fallback to index 0: a query that matches
 * no view is a sentence, and the right response to pressing ↵ on a sentence is
 * nothing at all, with the actions visible one ↓ away.
 */
export function initialCursor(options: readonly PaletteOption[]): number {
  return options.findIndex((option) => option.kind === "nav");
}

export type EnterIntent =
  | { type: "none" }
  | { type: "navigate"; view: ViewId }
  | { type: "open"; url: string }
  /** First activation of a write: show the confirm row. Nothing has been sent. */
  | { type: "stage"; option: Extract<PaletteOption, { kind: "write" }> }
  /** Second ↵, with the confirm row on screen. This one really writes. */
  | { type: "commit"; write: PaletteWrite };

/**
 * What ↵ means right now. The only function that may return `commit`, and it
 * only does so when something is already staged.
 */
export function resolveEnter(
  options: readonly PaletteOption[],
  cursor: number,
  staged: Extract<PaletteOption, { kind: "write" }> | null,
): EnterIntent {
  if (staged !== null) return { type: "commit", write: staged.write };

  const option = cursor < 0 ? undefined : options[cursor];
  if (option === undefined) return { type: "none" };
  if (option.kind === "nav") return { type: "navigate", view: option.view };
  if (option.kind === "link") return { type: "open", url: option.url };
  return { type: "stage", option };
}

/** One line stating what a staged write is about to do, for the confirm row. */
export function describeWrite(write: PaletteWrite): string {
  return `${write.repoSlug} · ${write.labels.join(", ")}`;
}
