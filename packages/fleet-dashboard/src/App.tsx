import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Palette } from "./components/Palette";
import { Shell, type NavEntry } from "./components/Shell";
import { Banner } from "./components/ui";
import { TokenGate } from "./components/TokenGate";
import { fleetConfig } from "./fleet.config";
import { LABELS } from "./lib/labels";
import { readLastReviewed, writeLastReviewed } from "./lib/review";
import { selectParked, selectPlan, selectProposed, selectQueue } from "./lib/select";
import { clearResponseCache } from "./sources/github/client";
import { createGitHubSource } from "./sources/github/githubSource";
import { createGitHubWriter } from "./sources/github/writer";
import { emptySnapshot, type FleetSnapshot, type FleetWriter } from "./sources/types";
import { AppsIndex, AppView } from "./views/AppView";
import type { Actions, Ctx, ViewId } from "./views/context";
import { Copilot } from "./views/Copilot";
import { Gardeners } from "./views/Gardeners";
import { Inbox } from "./views/Inbox";
import { NewApp } from "./views/NewApp";
import { Now } from "./views/Now";
import { Queue } from "./views/Queue";
import { Review } from "./views/Review";
import { Secrets } from "./views/Secrets";
import { Watchdog } from "./views/Watchdog";

const TOKEN_KEY = "fleet-dashboard:token";

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [snapshot, setSnapshot] = useState<FleetSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("review");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [since, setSince] = useState(() => readLastReviewed());
  const [busy, setBusy] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeDone, setWriteDone] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Another source (a `@supa-media/dev-assistant` Convex source) would join
  // here and merge into the snapshot by project key.
  const source = useMemo(
    () => (token === null ? null : createGitHubSource(fleetConfig, token)),
    [token],
  );
  const writer: FleetWriter | null = useMemo(
    () => (token === null ? null : createGitHubWriter(token)),
    [token],
  );

  const refresh = useCallback(async () => {
    if (!source) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setFatal(null);
    try {
      const next = await source.fetchFleet({ since, signal: controller.signal });
      if (!controller.signal.aborted) setSnapshot(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFatal(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [source, since]);

  // Fetch once when a token appears. No polling on purpose: the fleet is
  // checked twice a day, and a background timer would burn the API budget
  // (and, on a phone, the battery) for a page nobody is looking at.
  useEffect(() => {
    void refresh();
    return () => inFlight.current?.abort();
  }, [refresh]);

  // ⌘K / Ctrl-K from anywhere. Registered on the document rather than on a
  // focusable element so it works while reading, which is the state the palette
  // is for.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const actions: Actions = useMemo(
    () => ({
      busy,
      error: writeError,
      done: writeDone,
      run(key, fn) {
        if (writer === null || busy !== null) return;
        setBusy(key);
        setWriteError(null);
        setWriteDone(null);
        void (async () => {
          try {
            await fn(writer);
            setWriteDone(key);
            // Re-read rather than patching local state: the whole point of the
            // label convention is that GitHub is the state, and a screen that
            // showed a label it had not confirmed would be the first place the
            // two could silently diverge.
            await refresh();
          } catch (error) {
            setWriteError(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(null);
          }
        })();
      },
    }),
    [busy, refresh, writeDone, writeError, writer],
  );

  const acceptToken = useCallback((next: string) => {
    // Start cold: the response cache is keyed by request path with no reference
    // to the credential that fetched it, so a token swap must not inherit the
    // previous identity's cached bodies.
    clearResponseCache();
    try {
      localStorage.setItem(TOKEN_KEY, next);
    } catch {
      // Private-mode browsers: keep the token in memory for this session only.
    }
    setToken(next);
  }, []);

  const forgetToken = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing to clean up.
    }
    // The ETag cache holds full REST bodies, including private-repo workflow
    // file contents. Clearing only the token would leave the fleet's private
    // data sitting in sessionStorage after "Sign out".
    clearResponseCache();
    inFlight.current?.abort();
    setToken(null);
    setSnapshot(emptySnapshot());
    setFatal(null);
    setLoading(false);
  }, []);

  const markReviewed = useCallback(() => {
    const now = new Date().toISOString();
    writeLastReviewed(now);
    setSince(now);
  }, []);

  if (token === null) return <TokenGate onSubmit={acceptToken} />;

  const ctx: Ctx = { config: fleetConfig, snapshot, actions, since, navigate: setView };

  const proposed = selectProposed(snapshot.issues).length;
  const parked = selectParked(snapshot.issues).length;
  const queued = selectQueue(snapshot.issues).reduce((sum, group) => sum + group.issues.length, 0);
  const planned = selectPlan(snapshot.issues).reduce((sum, group) => sum + group.issues.length, 0);
  const working = snapshot.issues.filter((issue) =>
    issue.labels.includes(LABELS.inProgress),
  ).length;

  const entries: NavEntry[] = [
    { id: "review", label: "☀️ Review", count: planned + parked, alert: parked > 0 },
    { id: "inbox", label: "📥 Inbox", count: proposed },
    { id: "copilot", label: "✦ Copilot" },
    { id: "now", label: "◉ Now", count: working },
    { id: "queue", label: "☰ Queue", count: queued },
    ...snapshot.projects.map((project, index) => ({
      id: `app:${project.key}` as ViewId,
      label: project.label,
      sub: true,
      ...(index === 0 ? { section: "Apps" } : {}),
    })),
    { id: "watchdog", label: "🐕 Watchdog", section: "Fleet" },
    { id: "gardeners", label: "🌱 Gardeners" },
    { id: "secrets", label: "🔐 Secrets" },
    { id: "newapp", label: "＋ New app" },
  ];

  return (
    <>
      <Shell
        snapshot={snapshot}
        loading={loading}
        view={view}
        entries={entries}
        onNavigate={setView}
        onOpenPalette={() => setPaletteOpen(true)}
        onRefresh={() => void refresh()}
        onSignOut={forgetToken}
      >
        {fatal !== null && <Banner tone="err">{fatal}</Banner>}
        {snapshot.errors.length > 0 && (
          <Banner tone="err">
            Partial data — the rest of the page is still accurate:
            <ul>
              {snapshot.errors.map((error, index) => (
                <li key={`${error.scope}-${index}`}>
                  <b>{error.scope}</b> {error.message}
                </li>
              ))}
            </ul>
          </Banner>
        )}
        {writeError !== null && <Banner tone="err">Write failed: {writeError}</Banner>}

        <CurrentView ctx={ctx} view={view} onMarkReviewed={markReviewed} onOpenPalette={() => setPaletteOpen(true)} />
      </Shell>

      {paletteOpen && <Palette ctx={ctx} onClose={() => setPaletteOpen(false)} />}
    </>
  );
}

function CurrentView({
  ctx,
  view,
  onMarkReviewed,
  onOpenPalette,
}: {
  ctx: Ctx;
  view: ViewId;
  onMarkReviewed: () => void;
  onOpenPalette: () => void;
}) {
  if (view.startsWith("app:")) {
    const key = view.slice("app:".length);
    const project = ctx.snapshot.projects.find((candidate) => candidate.key === key);
    return project === undefined ? <AppsIndex ctx={ctx} /> : <AppView ctx={ctx} project={project} />;
  }

  switch (view) {
    case "inbox":
      return <Inbox ctx={ctx} />;
    case "copilot":
      return <Copilot ctx={ctx} onOpenPalette={onOpenPalette} />;
    case "now":
      return <Now ctx={ctx} />;
    case "queue":
      return <Queue ctx={ctx} />;
    case "watchdog":
      return <Watchdog ctx={ctx} />;
    case "gardeners":
      return <Gardeners ctx={ctx} />;
    case "secrets":
      return <Secrets ctx={ctx} />;
    case "newapp":
      return <NewApp ctx={ctx} />;
    default:
      return <Review ctx={ctx} onMarkReviewed={onMarkReviewed} />;
  }
}
