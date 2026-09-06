import { create } from "zustand";
import { persist } from "zustand/middleware";

const currentMonth = () => new Date().toISOString().slice(0, 7);

interface SettingsStore {
  // General
  timeoutMs: number;
  followRedirects: boolean;
  sslVerify: boolean;

  // AI
  claudeApiKey: string;
  claudeModel: string;
  useOwnKey: boolean;
  autoGenerateTests: boolean;
  aiDebugAssist: boolean;
  smartAutocomplete: boolean;

  // Usage (resets monthly)
  tokensUsed: number;
  testsGenerated: number;
  debugAssists: number;
  usageMonth: string;

  // Appearance
  theme: "dark" | "light" | "system";
  editorFont: string;
  uiFontSize: number;
  accentColor: string;
  compactMode: boolean;
  showLineNumbers: boolean;
  wordWrap: boolean;
  animations: boolean;

  // Proxy
  useSystemProxy: boolean;
  proxyHttp: string;
  proxyHttpPort: string;
  proxyHttps: string;
  proxyHttpsPort: string;
  noProxy: string;
  proxySslVerify: boolean;
  clientCerts: boolean;
  clientCertPem: string;
  clientKeyPem: string;
  connectionTimeoutMs: number;
  readTimeoutMs: number;
  maxResponseSizeMb: number;

  // Privacy
  analytics: boolean;
  crashReports: boolean;
  perfMetrics: boolean;
  rememberMe: boolean;
  lockOnSleep: boolean;
  historyRetentionDays: number;

  // Cookie jar
  enableCookieJar: boolean;

  // Onboarding
  tourSeen: boolean;
  lastSeenVersion: string;
  /**
   * Si ya se preguntó por la telemetría. Va aparte de `analytics` a propósito:
   * quien dijo que no deja `analytics` en false igual que quien no ha contestado,
   * y sin este flag volveríamos a preguntárselo en cada arranque.
   */
  analyticsAsked: boolean;

  // Actions
  setTimeoutMs: (v: number) => void;
  setFollowRedirects: (v: boolean) => void;
  setSslVerify: (v: boolean) => void;
  setClaudeApiKey: (v: string) => void;
  setClaudeModel: (v: string) => void;
  setTourSeen: (v: boolean) => void;
  patch: (partial: Partial<Omit<SettingsStore, "patch" | "trackUsage" | "setTimeoutMs" | "setFollowRedirects" | "setSslVerify" | "setClaudeApiKey" | "setClaudeModel" | "setTourSeen">>) => void;
  trackUsage: (type: "tests" | "debugs", tokens?: number) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // General
      timeoutMs: 30000,
      followRedirects: true,
      sslVerify: true,

      // AI
      claudeApiKey: localStorage.getItem("flux_claude_key") ?? "",
      claudeModel: "claude-sonnet-4-6",
      useOwnKey: !!localStorage.getItem("flux_claude_key"),
      autoGenerateTests: true,
      aiDebugAssist: true,
      smartAutocomplete: false,

      // Usage
      tokensUsed: 0,
      testsGenerated: 0,
      debugAssists: 0,
      usageMonth: currentMonth(),

      // Appearance
      theme: "dark",
      editorFont: "Geist Mono",
      uiFontSize: 13,
      accentColor: "#A855F7",
      compactMode: false,
      showLineNumbers: true,
      wordWrap: true,
      animations: true,

      // Proxy
      useSystemProxy: false,
      proxyHttp: "",
      proxyHttpPort: "8080",
      proxyHttps: "",
      proxyHttpsPort: "8443",
      noProxy: "localhost,127.0.0.1",
      proxySslVerify: true,
      clientCerts: false,
      clientCertPem: "",
      clientKeyPem: "",
      connectionTimeoutMs: 10000,
      readTimeoutMs: 30000,
      maxResponseSizeMb: 50,

      // Privacy
      analytics: false,
      crashReports: true,
      perfMetrics: false,
      rememberMe: true,
      lockOnSleep: false,
      historyRetentionDays: 30,

      // Cookie jar
      enableCookieJar: false,

      // Onboarding
      tourSeen: false,
      lastSeenVersion: "0.0.0",
      analyticsAsked: false,

      // Actions
      setTimeoutMs: (timeoutMs) => set({ timeoutMs }),
      setFollowRedirects: (followRedirects) => set({ followRedirects }),
      setSslVerify: (sslVerify) => set({ sslVerify }),
      setClaudeApiKey: (claudeApiKey) => {
        localStorage.setItem("flux_claude_key", claudeApiKey);
        // Guardar una key significa querer usarla; borrarla, volver al tier gratuito.
        set({ claudeApiKey, useOwnKey: !!claudeApiKey });
      },
      setClaudeModel: (claudeModel) => set({ claudeModel }),
      setTourSeen: (tourSeen) => set({ tourSeen }),
      patch: (partial) => set(partial as any),
      trackUsage: (type, tokens = 500) => {
        const s = get();
        const month = currentMonth();
        if (s.usageMonth !== month) {
          set({
            usageMonth: month,
            tokensUsed: tokens,
            testsGenerated: type === "tests" ? 1 : 0,
            debugAssists: type === "debugs" ? 1 : 0,
          });
        } else {
          set({
            tokensUsed: s.tokensUsed + tokens,
            testsGenerated: type === "tests" ? s.testsGenerated + 1 : s.testsGenerated,
            debugAssists: type === "debugs" ? s.debugAssists + 1 : s.debugAssists,
          });
        }
      },
    }),
    {
      name: "flux-settings",
      version: 1,
      // El id de Haiku llevaba sufijo de fecha mientras los otros dos usaban
      // alias, así que el radio no se marcaba. Se normaliza al rehidratar.
      migrate: (persisted) => {
        const state = persisted as Partial<SettingsStore> | undefined;
        if (state?.claudeModel === "claude-haiku-4-5-20251001") {
          return { ...state, claudeModel: "claude-haiku-4-5" };
        }
        return state;
      },
    }
  )
);

/**
 * El modelo solo se enseña cuando lo eligió el usuario. En el tier gratuito
 * lo decide el proxy, así que la app no lo nombra.
 */
export function useUsingOwnKey(): boolean {
  return useSettingsStore(s => !!s.claudeApiKey && s.useOwnKey);
}
