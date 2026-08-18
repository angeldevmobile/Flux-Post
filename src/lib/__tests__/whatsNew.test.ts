import { describe, it, expect } from "vitest";
import { isNewer } from "@/lib/whatsNew";

describe("isNewer", () => {
  it("compares by numeric segment, not lexicographically", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.1.9", "0.1.10")).toBe(false);
    expect(isNewer("0.2.0", "0.10.0")).toBe(false);
  });

  it("is false for equal versions", () => {
    expect(isNewer("1.2.3", "1.2.3")).toBe(false);
  });

  it("treats missing segments as zero", () => {
    expect(isNewer("1.1", "1.0.9")).toBe(true);
    expect(isNewer("1.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0.1", "1.0")).toBe(true);
  });

  it("beats the default lastSeenVersion", () => {
    expect(isNewer("0.1.7", "0.0.0")).toBe(true);
  });
});
