import { useSettingsStore } from "@/stores/settings";

interface AnalyticsEvent {
  type: string;
  data?: unknown;
  ts: number;
}

interface CrashEvent {
  message: string;
  ts: number;
}

interface PerfEvent {
  url: string;
  method: string;
  ms: number;
  status: number;
  ts: number;
}

const events: AnalyticsEvent[] = [];
const crashes: CrashEvent[] = [];
const perf: PerfEvent[] = [];

export function trackEvent(type: string, data?: unknown) {
  if (!useSettingsStore.getState().analytics) return;
  events.push({ type, data, ts: Date.now() });
}

export function trackCrash(message: string) {
  if (!useSettingsStore.getState().crashReports) return;
  crashes.push({ message, ts: Date.now() });
}

export function trackPerf(url: string, method: string, ms: number, status: number) {
  if (!useSettingsStore.getState().perfMetrics) return;
  perf.push({ url, method, ms, status, ts: Date.now() });
}

export function getAnalyticsSnapshot() {
  return {
    events: [...events],
    crashes: [...crashes],
    perf: [...perf],
  };
}

export function initCrashReporting() {
  window.onerror = (msg) => {
    trackCrash(typeof msg === "string" ? msg : "Unknown JS error");
  };
  window.addEventListener("unhandledrejection", (e) => {
    trackCrash(String(e.reason ?? "Unhandled promise rejection"));
  });
}
