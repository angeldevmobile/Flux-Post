import { create } from "zustand";

export type LogLevel = "log" | "info" | "warn" | "error";
export type LogSource = "pre-request" | "post-response" | "test";

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  source: LogSource;
}

interface ConsoleStore {
  entries: LogEntry[];
  push: (level: LogLevel, message: string, source: LogSource) => void;
  clear: () => void;
}

let seq = 0;

export const useConsoleStore = create<ConsoleStore>((set) => ({
  entries: [],
  push: (level, message, source) =>
    set((s) => ({
      entries: [
        ...s.entries,
        { id: `log-${++seq}`, level, message, timestamp: Date.now(), source },
      ],
    })),
  clear: () => set({ entries: [] }),
}));
