import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActiveWork, Gardeners, Header, NeedsYou, ProjectCards } from "./components/panels";
import { TokenGate } from "./components/TokenGate";
import { fleetConfig } from "./fleet.config";
import { clearResponseCache } from "./sources/github/client";
import { createGitHubSource } from "./sources/github/githubSource";
import { emptySnapshot, type FleetSnapshot } from "./sources/types";

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
  const inFlight = useRef<AbortController | null>(null);

  // v2 hook: this is where a second source (a `@supa-media/dev-assistant`
  // Convex source) joins the list and its snapshot merges by project key.
  const source = useMemo(
    () => (token === null ? null : createGitHubSource(fleetConfig, token)),
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
      const next = await source.fetchFleet(controller.signal);
      if (!controller.signal.aborted) setSnapshot(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFatal(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [source]);

  // Fetch once when a token appears. No polling on purpose: the fleet is
  // checked a few times a day, and a background timer would burn the API
  // budget (and, on a phone, the battery) for a page nobody is looking at.
  useEffect(() => {
    void refresh();
    return () => inFlight.current?.abort();
  }, [refresh]);

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

  if (token === null) return <TokenGate onSubmit={acceptToken} />;

  return (
    <main className="app">
      <Header
        name={fleetConfig.name}
        snapshot={snapshot}
        loading={loading}
        onRefresh={() => void refresh()}
        onForgetToken={forgetToken}
      />
      {fatal !== null && (
        <p className="fatal" role="alert">
          {fatal}
        </p>
      )}
      <ProjectCards projects={snapshot.projects} />
      <ActiveWork projects={snapshot.projects} />
      <Gardeners projects={snapshot.projects} />
      <NeedsYou prs={snapshot.needsYou} />
      <footer className="footer">
        Read-only. Data straight from api.github.com — nothing is stored server-side.
      </footer>
    </main>
  );
}
