import type { ReactNode } from "react";

import { formatUsd } from "../lib/cost";
import { absolute } from "../lib/time";
import type { FleetSnapshot } from "../sources/types";
import type { ViewId } from "../views/context";

/**
 * Topbar + nav + main.
 *
 * The nav is a column of dark segmented pills on desktop and wraps into a row
 * of the same pills on a phone — the same control, reflowed, rather than a
 * separate mobile menu to keep in sync.
 */

export interface NavEntry {
  id: ViewId;
  label: string;
  /** Shown as a badge. `null` renders nothing — a badge of `0` is noise. */
  count?: number | null;
  /** Red badge: this is something waiting on you. */
  alert?: boolean;
  /** Indented under an "Apps" heading. */
  sub?: boolean;
  /** Section heading rendered above this entry. */
  section?: string;
}

export function Shell({
  snapshot,
  loading,
  view,
  entries,
  onNavigate,
  onOpenPalette,
  onRefresh,
  onSignOut,
  children,
}: {
  snapshot: FleetSnapshot;
  loading: boolean;
  view: ViewId;
  entries: NavEntry[];
  onNavigate: (view: ViewId) => void;
  onOpenPalette: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo">⌘ supa fleet</span>
        <button type="button" className="cmdk" onClick={onOpenPalette}>
          File, dump, or jump to anything…
          <kbd>⌘K</kbd>
        </button>
        <div className="topbar__meta">
          <span title={snapshot.spendReportedAt === null ? "no cost report found" : `report updated ${absolute(snapshot.spendReportedAt)}`}>
            {formatUsd(snapshot.spendReportedUsd)}
          </span>
          {snapshot.rateLimit !== null && (
            <span title={`resets ${absolute(snapshot.rateLimit.resetAt)}`}>
              {snapshot.rateLimit.remaining}/{snapshot.rateLimit.limit}
            </span>
          )}
          <button type="button" className="bt quiet" onClick={onRefresh} disabled={loading}>
            {loading ? "…" : "refresh"}
          </button>
          <button type="button" className="bt quiet" onClick={onSignOut}>
            sign out
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="nav" aria-label="Views">
          {entries.map((entry) => (
            <div key={entry.id} style={{ display: "contents" }}>
              {entry.section !== undefined && <div className="nav__sec">{entry.section}</div>}
              <button
                type="button"
                className={`nav__item${entry.sub === true ? " sub" : ""}${view === entry.id ? " on" : ""}`}
                aria-current={view === entry.id ? "page" : undefined}
                onClick={() => onNavigate(entry.id)}
              >
                {entry.label}
                {entry.count != null && entry.count > 0 && (
                  <span className={`nav__badge${entry.alert === true ? " alert" : ""}`}>
                    {entry.count}
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>

        <main className="main">{children}</main>
      </div>
    </div>
  );
}
