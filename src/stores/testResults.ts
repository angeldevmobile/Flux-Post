import { create } from "zustand";

export interface TestResult {
  name: string;
  pass: boolean;
  error?: string;
}

interface TestResultsStore {
  results: TestResult[];
  setResults: (results: TestResult[]) => void;
  clear: () => void;
}

export const useTestResultsStore = create<TestResultsStore>((set) => ({
  results: [],
  setResults: (results) => set({ results }),
  clear: () => set({ results: [] }),
}));
