import type { ReactNode } from "react";

import { absolute, age } from "../lib/time";
import type { RunSummary } from "../sources/types";

/**
 * The handful of shapes every view is built from: a header, a row list, a card,
 * a status dot, an empty state.
 *
 * They live in one file because they are one design system, and because the
 * alternative — nine files of twelve lines each — makes the visual language
 * harder to keep consistent, not easier.
 */

export type Tone = "n" | "g" | "y" | "r" | "p";

export function ViewHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="vh">
      <h1>{title}</h1>
      {sub !== undefined && <span className="sub">{sub}</span>}
      {actions !== undefined && <span className="sp">{actions}</span>}
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="rows">{children}</div>;
}

export function Group({
  children,
  tone = "n",
  right,
}: {
  children: ReactNode;
  tone?: Tone;
  right?: ReactNode;
}) {
  return (
    <div className={`grp ${tone}`}>
      {children}
      {right !== undefined && <span className="r">{right}</span>}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="row">{children}</div>;
}

export function Pill({ tone = "n", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Dot({ tone = "n", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return <span className={`dot ${tone}${pulse ? " pulse" : ""}`} aria-hidden="true" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** A workflow run rendered as a dot plus its age, linking to the run. */
export function RunDot({ run, fallback }: { run: RunSummary | null; fallback: string }) {
  if (run === null) return <span className="muted">{fallback}</span>;
  const tone: Tone =
    run.state === "success" ? "g" : run.state === "failure" ? "r" : run.state === "running" ? "y" : "n";
  return (
    <a
      className="pf"
      href={run.url}
      target="_blank"
      rel="noreferrer"
      title={`${run.name} — ${absolute(run.at)}`}
    >
      <Dot tone={tone} pulse={run.state === "running"} />
      <span className="num">{age(run.at)}</span>
    </a>
  );
}

export function Banner({ tone, children }: { tone: "err" | "ok"; children: ReactNode }) {
  return (
    <p className={`banner ${tone}`} role={tone === "err" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/**
 * The ⚡ toggle: add or remove `agent:notify`.
 *
 * Disabled while its own write is in flight rather than optimistically flipped —
 * a label that appears to be set and silently isn't is the failure mode that
 * makes someone stop trusting the interrupt switch.
 */
export function NotifyToggle({
  on,
  busy,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`flag${on ? " on" : ""}`}
      disabled={busy}
      onClick={onToggle}
      title={on ? "Telegram pings you at each milestone" : "Silent — batches to your next review"}
      aria-pressed={on}
    >
      {busy ? "…" : on ? "⚡ bother me" : "⚡"}
    </button>
  );
}
