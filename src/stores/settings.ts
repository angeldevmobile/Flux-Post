import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsStore {
  timeoutMs: number;
  followRedirects: boolean;
  sslVerify: boolean;
  claudeApiKey: string;
  claudeModel: string;

  setTimeoutMs: (v: number) => void;
  setFollowRedirects: (v: boolean) => void;
  setSslVerify: (v: boolean) => void;
  setClaudeApiKey: (v: string) => void;
  setClaudeModel: (v: string) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      timeoutMs: 30000,
      followRedirects: true,
      sslVerify: true,
      claudeApiKey: localStorage.getItem("flux_claude_key") ?? "",
      claudeModel: "claude-sonnet-4-6",

      setTimeoutMs: (timeoutMs) => set({ timeoutMs }),
      setFollowRedirects: (followRedirects) => set({ followRedirects }),
      setSslVerify: (sslVerify) => set({ sslVerify }),
      setClaudeApiKey: (claudeApiKey) => {
        localStorage.setItem("flux_claude_key", claudeApiKey);
        set({ claudeApiKey });
      },
      setClaudeModel: (claudeModel) => set({ claudeModel }),
    }),
    { name: "flux-settings" }
  )
);
