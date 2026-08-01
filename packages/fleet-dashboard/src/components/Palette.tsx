import { useEffect, useMemo, useRef, useState } from "react";

import { LABELS } from "../lib/labels";
import type { Ctx, ViewId } from "../views/context";

/**
 * The ⌘K palette — real, keyboard-driven, and the whole of what "Copilot"
 * ships in v2.
 *
 * Four kinds of action: jump to a view, file an issue against an app, save the
 * typed text as an inbox dump, open Claude Code. The first is navigation; the
 * middle two are GitHub writes; the last is a link. Nothing here talks to a
 * model, and the Copilot view says so out loud.
 */

interface Option {
  id: string;
  label: string;
  hint: string;
  run(): void;
}

export function Palette({
  ctx,
  onClose,
}: {
  ctx: Ctx;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const options = useMemo<Option[]>(() => {
    const text = query.trim();
    const views: Array<{ id: ViewId; label: string }> = [
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
    ];

    const list: Option[] = [];

    if (text !== "") {
      // Writes come first when there is text, because typing a sentence into a
      // palette is a statement, not a search for a nav item.
      for (const repo of ctx.config.repos) {
        list.push({
          id: `issue:${repo.slug}`,
          label: `File issue → ${repo.label}`,
          hint: LABELS.ready,
          run: () => {
            ctx.actions.run(`palette-issue:${repo.slug}`, async (writer) => {
              await writer.createIssue(repo.slug, {
                title: text.length > 72 ? `${text.slice(0, 69)}…` : text,
                body: `${text}\n\n_Filed from the fleet dashboard palette._`,
                labels: [LABELS.ready],
              });
            });
            onClose();
          },
        });
      }
      list.push({
        id: "dump",
        label: `Save to inbox as a dump → ${ctx.config.repos[0]?.label ?? "—"}`,
        hint: LABELS.inboxRaw,
        run: () => {
          const slug = ctx.config.repos[0]?.slug;
          if (slug === undefined) return;
          ctx.actions.run("palette-dump", async (writer) => {
            await writer.createIssue(slug, {
              title: text.length > 72 ? `${text.slice(0, 69)}…` : text,
              body: text,
              labels: [LABELS.inboxRaw],
            });
          });
          ctx.navigate("inbox");
          onClose();
        },
      });
    }

    list.push({
      id: "claude",
      label: "Open Claude Code",
      hint: "new tab",
      run: () => {
        window.open(ctx.config.claudeCodeUrl, "_blank", "noopener,noreferrer");
        onClose();
      },
    });

    for (const view of views) {
      list.push({
        id: `nav:${view.id}`,
        label: `Go to ${view.label}`,
        hint: "jump",
        run: () => {
          ctx.navigate(view.id);
          onClose();
        },
      });
    }

    // Filtering only applies to the jump entries: an action built *from* the
    // typed text must not be filtered out by that same text.
    const needle = text.toLowerCase();
    return list.filter(
      (option) => !option.id.startsWith("nav:") || option.label.toLowerCase().includes(needle),
    );
  }, [ctx, query, onClose]);

  const active = Math.min(cursor, Math.max(options.length - 1, 0));

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
          placeholder="File, dump, or jump to anything…"
          aria-label="Command"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              options[active]?.run();
            }
          }}
        />
        {options.length === 0 ? (
          <p className="palette__none">Nothing matches.</p>
        ) : (
          <ul className="palette__list">
            {options.slice(0, 12).map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  className={`palette__opt${index === active ? " hi" : ""}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={option.run}
                >
                  {option.label}
                  <span className="k">{option.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="palette__hint">
          ↑↓ to move · ↵ to run · esc to close. No model is involved — every action here is a GitHub
          call or a link.
        </p>
      </div>
    </div>
  );
}
