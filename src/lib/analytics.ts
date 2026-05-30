import { useSettingsStore } from "@/stores/settings";
import { supabase } from "@/lib/supabase";

const APP_VERSION = "0.1.4";

interface AnalyticsEvent {
  type: string;
  data?: unknown;
  ts: number;
}

interface PerfEvent {
  url: string;
  method: string;
  ms: number;
  status: number;
  ts: number;
}

const pendingEvents: AnalyticsEvent[] = [];
const pendingPerf: PerfEvent[] = [];

async function flushEvents() {
  if (pendingEvents.length === 0 && pendingPerf.length === 0) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user.id ?? null;

    const eventsToSend = pendingEvents.splice(0);
    const perfToSend = pendingPerf.splice(0);

    if (eventsToSend.length > 0) {
      await supabase.from("analytics_events").insert(
        eventsToSend.map((e) => ({
          user_id: userId,
          type: e.type,
          data: e.data ?? null,
          ts: e.ts,
          app_version: APP_VERSION,
        }))
      );
    }

    if (perfToSend.length > 0) {
      await supabase.from("analytics_events").insert(
        perfToSend.map((p) => ({
          user_id: userId,
          type: "request_perf",
          data: { url: p.url, method: p.method, ms: p.ms, status: p.status },
          ts: p.ts,
          app_version: APP_VERSION,
        }))
      );
    }
  } catch { /* network unavailable — events are lost, acceptable for analytics */ }
}

export function trackEvent(type: string, data?: unknown) {
  if (!useSettingsStore.getState().analytics) return;
  pendingEvents.push({ type, data, ts: Date.now() });
}

export function trackCrash(message: string) {
  if (!useSettingsStore.getState().crashReports) return;
  supabase.auth.getSession().then(({ data: { session } }) =>
    supabase.from("crash_reports").insert({
      user_id: session?.user.id ?? null,
      message,
      ts: Date.now(),
      app_version: APP_VERSION,
    })
  ).catch(() => { /* swallow — avoid recursive unhandledrejection */ });
}

export function trackPerf(url: string, method: string, ms: number, status: number) {
  if (!useSettingsStore.getState().perfMetrics) return;
  pendingPerf.push({ url, method, ms, status, ts: Date.now() });
}

export function initCrashReporting() {
  window.onerror = (msg) => {
    trackCrash(typeof msg === "string" ? msg : "Unknown JS error");
  };
  window.addEventListener("unhandledrejection", (e) => {
    trackCrash(String(e.reason ?? "Unhandled promise rejection"));
  });
  window.addEventListener("beforeunload", () => {
    flushEvents();
  });

  // Flush every 60 seconds
  setInterval(flushEvents, 60_000);
}
