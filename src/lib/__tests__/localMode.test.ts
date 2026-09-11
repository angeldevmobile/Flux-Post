import { describe, it, expect, beforeEach } from "vitest";
import { isLocalMode, setLocalMode } from "@/lib/localMode";

beforeEach(() => {
  localStorage.clear();
});

describe("localMode", () => {
  it("is off until it is chosen", () => {
    expect(isLocalMode()).toBe(false);
  });

  it("remembers the choice", () => {
    setLocalMode(true);
    expect(isLocalMode()).toBe(true);
  });

  it("can be turned off again, which is what signing in does", () => {
    setLocalMode(true);
    setLocalMode(false);
    expect(isLocalMode()).toBe(false);
  });

  it("stores nothing when off, so an old install is not marked", () => {
    setLocalMode(false);
    expect(localStorage.getItem("flux_local_mode")).toBeNull();
  });

  it("treats any other stored value as off", () => {
    localStorage.setItem("flux_local_mode", "yes");
    expect(isLocalMode()).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(() => isLocalMode()).not.toThrow();
    expect(isLocalMode()).toBe(false);
    expect(() => setLocalMode(true)).not.toThrow();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  });
});
