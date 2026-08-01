import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Palette } from "./components/Palette";
import { Shell, type NavEntry } from "./components/Shell";
import { Banner } from "./components/ui";
import { TokenGate } from "./components/TokenGate";
import { fleetConfig } from "./fleet.config";
import { LABELS } from "./lib/labels";
import { readLastReviewed, writeLastReviewed } from "./lib/review";
import { selectParked, selectPlan, selectProposed, selectQueue } from "./lib/select";
import {
  clearTokens,
  fleetOwners,
  hasAnyToken,
  loadTokens,
  ownersMissingToken,
  saveTokens,
  type TokenMap,
} from "./lib/tokens";
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

/**
 * The fleet's distinct resource owners, in config order. Derived from the repo
 * slugs rather than configured, so adding a repo under a fourth owner adds its
 * token field to the gate with no further wiring.
 */
const OWNERS = fleetOwners(fleetConfig.repos);
const OWNER_NAMES = OWNERS.map((group) => group.owner);

export function App() {
  // One token per owner. `loadTokens` also migrates v2's single-token key, once.
  const [tokens, setTokens] = useState<TokenMap>(() => loadTokens(OWNER_NAMES));
  const [gateOpen, setGateOpen] = useState(false);
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
    () => (hasAnyToken(tokens) ? createGitHubSource(fleetConfig, tokens) : null),
    [tokens],
  );
  const writer: FleetWriter | null = useMemo(
    () => (hasAnyToken(tokens) ? createGitHubWriter(tokens) : null),
    [tokens],
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
      run(key, fn, done) {
        // Every caller also disables its control while `busy` is set, so this is
        // a backstop rather than the guard — a silent return is only acceptable
        // for a click that could not have been made in the first place.
        if (writer === null || busy !== null) return;
        setBusy(key);
        setWriteError(null);
        setWriteDone(null);
        void (async () => {
          try {
            await fn(writer);
            setWriteDone(done ?? null);
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

  const acceptTokens = useCallback((next: TokenMap) => {
    // Start cold: the response cache is keyed by request path with no reference
    // to the credential that fetched it, so swapping *any* owner's token must
    // not inherit the previous identity's cached bodies.
    clearResponseCache();
    saveTokens(next);
    setTokens(next);
    setGateOpen(false);
  }, []);

  const forgetTokens = useCallback(() => {
    // Every owner, not the one whose card you were looking at: a "sign out"
    // that left two of three tokens in localStorage would be a lie with a
    // reassuring label on it.
    clearTokens();
    // The ETag cache holds full REST bodies, including private-repo workflow
    // file contents. Clearing only the tokens would leave the fleet's private
    // data sitting in sessionStorage after "Sign out".
    clearResponseCache();
    inFlight.current?.abort();
    setTokens({});
    setGateOpen(false);
    setSnapshot(emptySnapshot());
    setFatal(null);
    setLoading(false);
  }, []);

  const markReviewed = useCallback(() => {
    const now = new Date().toISOString();
    writeLastReviewed(now);
    setSince(now);
  }, []);

  // The gate is both the sign-in screen and the "one PAT expired" screen, so it
  // is reachable mid-session from the header rather than only via a sign-out.
  if (!hasAnyToken(tokens) || gateOpen) {
    return (
      <TokenGate
        owners={OWNERS}
        saved={tokens}
        onSubmit={acceptTokens}
        onCancel={hasAnyToken(tokens) ? () => setGateOpen(false) : null}
      />
    );
  }

  const missingOwners = ownersMissingToken(tokens, fleetConfig.repos);

  const ctx: Ctx = {
    config: fleetConfig,
    snapshot,
    actions,
    since,
    navigate: setView,
    openTokens: () => setGateOpen(true),
  };

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
        onEditTokens={() => setGateOpen(true)}
        missingOwners={missingOwners}
        onSignOut={forgetTokens}
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
        {writeError === null && writeDone !== null && <Banner tone="ok">{writeDone}</Banner>}

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
