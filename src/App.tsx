import { useState, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { NavRail, type Route } from "@/components/NavRail";
import { useAppearance } from "@/hooks/useAppearance";
import { TopBar } from "@/components/TopBar";
import { ProductTour } from "@/components/ProductTour";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import { Login } from "@/routes/auth/Login";
import { SignUp } from "@/routes/auth/SignUp";
import { RequestsRoute } from "@/routes/requests";
import { EnvironmentsRoute } from "@/routes/environments";
import { HistoryRoute } from "@/routes/history";
import { TestsRoute } from "@/routes/tests";
import { SettingsRoute } from "@/routes/settings";
import { CompareRoute } from "@/routes/compare";
import { WebSocketRoute } from "@/routes/websocket";
import { SseRoute } from "@/routes/sse";
import { LoadTestRoute } from "@/routes/loadtest";
import { MockRoute } from "@/routes/mock";
import { GrpcRoute } from "@/routes/grpc";
import { GitHubModal } from "@/routes/github";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/stores/user";
import { useSettingsStore } from "@/stores/settings";
import { loadSession, saveSession, clearSessionDb, pruneHistory } from "@/lib/tauri";
import { initCrashReporting, trackEvent } from "@/lib/analytics";
import { checkForUpdates, installAndRestart } from "@/lib/updater";
import { syncOnLogin, stopSettingsSync, stopEnvironmentsSync } from "@/lib/sync";
import { useNavStore } from "@/stores/nav";

type AuthScreen = "loading" | "login" | "signup" | "app";

function AppShell() {
  const [route, setRoute] = useState<Route>("requests");
  const [githubOpen, setGithubOpen] = useState(false);
  const tourSeen = useSettingsStore(s => s.tourSeen);
  const [showTour, setShowTour] = useState(() => !useSettingsStore.getState().tourSeen);
  useAppearance();

  function handleNavigate(r: Route) {
    if (r === "github") { setGithubOpen(true); return; }
    setRoute(r);
  }

  const { pendingRoute, clearPending } = useNavStore();
  useEffect(() => {
    if (pendingRoute) { setRoute(pendingRoute); clearPending(); }
  }, [pendingRoute, clearPending]);

  // Apply the history retention setting once per launch
  useEffect(() => {
    const days = useSettingsStore.getState().historyRetentionDays;
    if (days > 0) pruneHistory(days).catch(() => { /* no bloquea el arranque */ });
  }, []);

  // Check for updates 4s after mount — non-blocking, silent on failure
  useEffect(() => {
    const t = setTimeout(async () => {
      const update = await checkForUpdates();
      if (!update) return;
      toast(`v${update.version} available`, {
        description: update.body ?? "A new version of Flux is ready.",
        action: { label: "Update & Restart", onClick: () => installAndRestart(update) },
        duration: Infinity,
      });
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  // Re-open tour when tourSeen is reset to false (e.g. "Launch Tour" from Settings)
  useEffect(() => {
    if (!tourSeen) setShowTour(true);
  }, [tourSeen]);

  // Navigate to requests so all tour targets are in the DOM
  useEffect(() => {
    if (showTour) setRoute("requests");
  }, [showTour]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: "var(--color-bg)" }}>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: { background: "#1A1A1A", border: "1px solid #27272A", color: "#FFFFFF" },
        }}
      />
      <TopBar onNavigate={handleNavigate} />
      <div className="flex flex-1 overflow-hidden">
        <NavRail active={route} onChange={handleNavigate} />
        <main className="flex flex-1 overflow-hidden">
          {route === "requests"     && <RequestsRoute />}
          {route === "collections"  && <RequestsRoute />}
          {route === "environments" && <EnvironmentsRoute />}
          {route === "tests"        && <TestsRoute />}
          {route === "history"      && <HistoryRoute />}
          {route === "compare"      && <CompareRoute />}
          {route === "websocket"    && <WebSocketRoute />}
          {route === "sse"          && <SseRoute />}
          {route === "loadtest"     && <LoadTestRoute />}
          {route === "mock"         && <MockRoute />}
          {route === "grpc"         && <GrpcRoute />}
          {route === "settings"     && <SettingsRoute />}
        </main>
      </div>
      <GitHubModal open={githubOpen} onClose={() => setGithubOpen(false)} />
      <ProductTour open={showTour} onDone={() => setShowTour(false)} />
      {!showTour && <WhatsNewDialog onNavigate={setRoute} />}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<AuthScreen>("loading");
  const { setSession, clearSession } = useUserStore();

  useEffect(() => {
    initCrashReporting();
    trackEvent("app_open");

    async function restoreSession() {
      const { rememberMe } = useSettingsStore.getState();

      // If "remember me" is off, always start at login — no session restore
      if (!rememberMe) {
        await clearSessionDb().catch(() => {});
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        setScreen("login");
        return;
      }

      // 1. Check if Supabase already has a valid session (from its own storage)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setSession(session);
        syncOnLogin(session.user.id).catch(() => {});
        setScreen("app");
        return;
      }

      // 2. Fallback: try SQLite local backup
      try {
        const row = await loadSession();
        if (row) {
          const { data, error } = await supabase.auth.setSession({
            access_token: row.accessToken,
            refresh_token: row.refreshToken ?? "",
          });
          if (!error && data.session) {
            setSession(data.session);
            await saveSession({
              accessToken: data.session.access_token,
              refreshToken: data.session.refresh_token,
              expiresAt: data.session.expires_at,
              userId: data.session.user.id,
              userEmail: data.session.user.email,
              userName: data.session.user.user_metadata?.full_name,
              userAvatar: data.session.user.user_metadata?.avatar_url,
            });
            syncOnLogin(data.session.user.id).catch(() => {});
            setScreen("app");
            return;
          }
          // Token expired and couldn't refresh — clear backup
          await clearSessionDb();
        }
      } catch {
        // SQLite not ready yet (first launch), continue to login
      }

      setScreen("login");
    }

    restoreSession();

    // Lock on sleep: sign out when waking from a long absence (>2 min)
    let hiddenAt: number | null = null;
    function handleVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        const awayMs = Date.now() - hiddenAt;
        hiddenAt = null;
        if (useSettingsStore.getState().lockOnSleep && awayMs > 120_000) {
          supabase.auth.signOut();
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    // Listen for auth state changes (token refresh, logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        stopSettingsSync();
        stopEnvironmentsSync();
        clearSession();
        await clearSessionDb();
        setScreen("login");
      } else if (session && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")) {
        setSession(session);
        if (event === "SIGNED_IN") syncOnLogin(session.user.id).catch(() => {});
        if (useSettingsStore.getState().rememberMe) {
          await saveSession({
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresAt: session.expires_at,
            userId: session.user.id,
            userEmail: session.user.email,
            userName: session.user.user_metadata?.full_name,
            userAvatar: session.user.user_metadata?.avatar_url,
          });
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  if (screen === "loading") {
    return (
      <div className="flex items-center justify-center w-full h-full" style={{ background: "#0A0A0A" }}>
        <div className="w-6 h-6 rounded-full border-2 border-[#A855F7] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (screen === "login") {
    return (
      <div className="h-full w-full">
        <Login onLogin={() => setScreen("app")} onGoSignUp={() => setScreen("signup")} />
      </div>
    );
  }

  if (screen === "signup") {
    return (
      <div className="h-full w-full">
        <SignUp onSignUp={() => setScreen("app")} onGoLogin={() => setScreen("login")} />
      </div>
    );
  }

  return <AppShell />;
}
