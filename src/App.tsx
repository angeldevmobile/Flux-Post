import { useState } from "react";
import { NavRail, type Route } from "@/components/NavRail";
import { TopBar } from "@/components/TopBar";
import { Login } from "@/routes/auth/Login";
import { SignUp } from "@/routes/auth/SignUp";
import { RequestsRoute } from "@/routes/requests";
import { EnvironmentsRoute } from "@/routes/environments";
import { HistoryRoute } from "@/routes/history";
import { TestsRoute } from "@/routes/tests";
import { SettingsRoute } from "@/routes/settings";

type AuthScreen = "login" | "signup" | "app";

function AppShell() {
  const [route, setRoute] = useState<Route>("requests");

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: "#0A0A0A" }}>
      <TopBar onNavigate={setRoute} />
      <div className="flex flex-1 overflow-hidden">
        <NavRail active={route} onChange={setRoute} />
        <main className="flex flex-1 overflow-hidden">
          {route === "requests"     && <RequestsRoute />}
          {route === "collections"  && <RequestsRoute />}
          {route === "environments" && <EnvironmentsRoute />}
          {route === "tests"        && <TestsRoute />}
          {route === "history"      && <HistoryRoute />}
          {route === "settings"     && <SettingsRoute />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<AuthScreen>("login");

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
