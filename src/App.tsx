import { useState, useEffect } from "react";
import { NavRail, type Route } from "@/components/NavRail";
import { useAppearance } from "@/hooks/useAppearance";
import { TopBar } from "@/components/TopBar";
import { Login } from "@/routes/auth/Login";
import { SignUp } from "@/routes/auth/SignUp";
import { RequestsRoute } from "@/routes/requests";
import { EnvironmentsRoute } from "@/routes/environments";
import { HistoryRoute } from "@/routes/history";
import { TestsRoute } from "@/routes/tests";
import { SettingsRoute } from "@/routes/settings";
import { CompareRoute } from "@/routes/compare";
import { WebSocketRoute } from "@/routes/websocket";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/stores/user";
import { useSettingsStore } from "@/stores/settings";
import { loadSession, saveSession, clearSessionDb } from "@/lib/tauri";
import { initCrashReporting, trackEvent } from "@/lib/analytics";
import { syncOnLogin, stopSettingsSync } from "@/lib/sync";

type AuthScreen = "loading" | "login" | "signup" | "app";

function AppShell() {
  const [route, setRoute] = useState<Route>("requests");
  useAppearance();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: "var(--color-bg)" }}>
      <TopBar onNavigate={setRoute} />
      <div className="flex flex-1 overflow-hidden">
        <NavRail active={route} onChange={setRoute} />
        <main className="flex flex-1 overflow-hidden">
          {route === "requests"     && <RequestsRoute />}
          {route === "collections"  && <RequestsRoute />}
          {route === "environments" && <EnvironmentsRoute />}
          {route === "tests"        && <TestsRoute />}
          {route === "history"      && <HistoryRoute />}
          {route === "compare"      && <CompareRoute />}
          {route === "websocket"    && <WebSocketRoute />}
          {route === "settings"     && <SettingsRoute />}
        </main>
      </div>
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
