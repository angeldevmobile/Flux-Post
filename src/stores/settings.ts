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
  autoGenerateTests: boolean;
  aiDebugAssist: boolean;
  smartAutocomplete: boolean;
  nlSearch: boolean;

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

  // Actions
  setTimeoutMs: (v: number) => void;
  setFollowRedirects: (v: boolean) => void;
  setSslVerify: (v: boolean) => void;
  setClaudeApiKey: (v: string) => void;
  setClaudeModel: (v: string) => void;
  patch: (partial: Partial<Omit<SettingsStore, "patch" | "trackUsage" | "setTimeoutMs" | "setFollowRedirects" | "setSslVerify" | "setClaudeApiKey" | "setClaudeModel">>) => void;
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
      autoGenerateTests: true,
      aiDebugAssist: true,
      smartAutocomplete: false,
      nlSearch: false,

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

      // Actions
      setTimeoutMs: (timeoutMs) => set({ timeoutMs }),
      setFollowRedirects: (followRedirects) => set({ followRedirects }),
      setSslVerify: (sslVerify) => set({ sslVerify }),
      setClaudeApiKey: (claudeApiKey) => {
        localStorage.setItem("flux_claude_key", claudeApiKey);
        set({ claudeApiKey });
      },
      setClaudeModel: (claudeModel) => set({ claudeModel }),
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
    { name: "flux-settings" }
  )
);
