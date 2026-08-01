import { useEffect, useMemo, useRef, useState } from "react";

import { LABELS } from "../lib/labels";
import {
  buildPaletteOptions,
  describeWrite,
  initialCursor,
  resolveEnter,
  type PaletteOption,
  type PaletteWrite,
} from "../lib/palette";
import type { Ctx, ViewId } from "../views/context";

/**
 * The ⌘K palette — real, keyboard-driven, and the whole of what "Copilot"
 * ships in v2.
 *
 * Three kinds of action: jump to a view, open Claude Code, file an issue or a
 * dump. The first two are free; the third is a GitHub write and is therefore a
 * **two-step** — activating it stages a confirm row naming the repo, the labels,
 * and the title, and only the next ↵ sends anything. ↵ on a typed query is
 * navigation and nothing else.
 *
 * The rules, and why, live in `lib/palette.ts`; this file is the rendering of
 * them. Nothing here talks to a model, and the Copilot view says so out loud.
 */
export function Palette({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [query, setQuery] = useState("");
  /**
   * Where the user has explicitly moved the cursor, or `null` for "wherever the
   * rules put it". Kept as an override rather than a plain index because the
   * option list is derived from the query: storing an absolute index would mean
   * writing it from a change handler that cannot see the list the next render
   * will build — which is exactly how the old palette ended up highlighting a
   * write after every keystroke.
   */
  const [moved, setMoved] = useState<number | null>(null);
  const [staged, setStaged] = useState<Extract<PaletteOption, { kind: "write" }> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const options = useMemo(
    () =>
      buildPaletteOptions({
        query,
        views: [
          { id: "review", label: "☀️ Review" },
          { id: "inbox", label: "📥 Inbox" },
          { id: "copilot", label: "✦ Copilot" },
          { id: "now", label: "◉ Now" },
          { id: "queue", label: "☰ Queue" },
          { id: "watchdog", label: "🐕 Watchdog" },
          { id: "gardeners", label: "🌱 Gardeners" },
          { id: "secrets", label: "🔐 Secrets" },
          { id: "newapp", label: "＋ New app" },
          ...ctx.snapshot.projects.map((project) => ({
            id: `app:${project.key}` as ViewId,
            label: project.label,
          })),
        ],
        repos: ctx.config.repos,
        claudeCodeUrl: ctx.config.claudeCodeUrl,
        readyLabel: LABELS.ready,
        rawLabel: LABELS.inboxRaw,
      }),
    [ctx.config, ctx.snapshot.projects, query],
  );

  const base = initialCursor(options);
  const active = moved === null ? base : Math.min(Math.max(moved, 0), options.length - 1);

  const commit = (write: PaletteWrite) => {
    ctx.actions.run(
      `palette:${write.intent}:${write.repoSlug}`,
      async (writer) => {
        await writer.createIssue(write.repoSlug, {
          title: write.title === "" ? "Inbox dump" : write.title,
          body: write.body,
          labels: write.labels,
        });
      },
      `Filed in ${write.repoLabel} with ${write.labels.join(", ")}.`,
    );
    if (write.thenNavigate !== null) ctx.navigate(write.thenNavigate);
    onClose();
  };

  const activate = (option: PaletteOption) => {
    switch (option.kind) {
      case "nav":
        ctx.navigate(option.view);
        onClose();
        return;
      case "link":
        window.open(option.url, "_blank", "noopener,noreferrer");
        onClose();
        return;
      default:
        // Never writes. Staging only — the confirm row is the second step.
        setStaged(option);
    }
  };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Jump to a view, or type a note to file…"
          aria-label="Command"
          onChange={(event) => {
            setQuery(event.target.value);
            setMoved(null);
            setStaged(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Escape backs out of the confirm row first, so a mis-staged write
              // is one key from being abandoned rather than one key from closing
              // the palette and losing the typed text.
              if (staged !== null) setStaged(null);
              else onClose();
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setStaged(null);
              setMoved((value) => Math.min((value ?? base) + 1, options.length - 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setStaged(null);
              setMoved((value) => Math.max((value ?? base) - 1, 0));
              return;
            }
            if (event.key !== "Enter") return;

            event.preventDefault();
            const intent = resolveEnter(options, active, staged);
            switch (intent.type) {
              case "navigate":
                ctx.navigate(intent.view);
                onClose();
                return;
              case "open":
                window.open(intent.url, "_blank", "noopener,noreferrer");
                onClose();
                return;
              case "stage":
                setStaged(intent.option);
                return;
              case "commit":
                commit(intent.write);
                return;
              default:
                // Nothing highlighted: the query matches no view. Doing nothing
                // is the point — see lib/palette.ts.
                return;
            }
          }}
        />

        {staged !== null ? (
          <div className="palette__confirm">
            <b>{staged.label}</b>
            <span className="sm">
              {describeWrite(staged.write)}
              <br />
              {staged.write.title === "" ? "Inbox dump" : staged.write.title}
            </span>
            <span className="bt-row">
              <button type="button" className="bt pri" onClick={() => commit(staged.write)}>
                ↵ file it
              </button>
              <button type="button" className="bt quiet" onClick={() => setStaged(null)}>
                esc — cancel
              </button>
            </span>
          </div>
        ) : (
          <>
            {query.trim() !== "" && base === -1 && (
              <p className="palette__none">
                No view matches that — ↵ does nothing. ↓ to file it as an issue instead.
              </p>
            )}
            <ul className="palette__list">
              {options.slice(0, 12).map((option, index) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={`palette__opt${index === active ? " hi" : ""}`}
                    onMouseEnter={() => setMoved(index)}
                    onClick={() => activate(option)}
                  >
                    {option.label}
                    <span className="k">{option.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="palette__hint">
          ↑↓ to move · ↵ jumps to the highlighted view · filing an issue always asks first · esc to
          close. No model is involved — every action here is a GitHub call or a link.
        </p>
      </div>
    </div>
  );
}
