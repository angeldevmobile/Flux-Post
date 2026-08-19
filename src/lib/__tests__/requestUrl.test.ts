import { describe, it, expect } from "vitest";
import { resolveRequestUrl } from "@/lib/requestUrl";

describe("resolveRequestUrl", () => {
  it("joins with exactly one slash", () => {
    expect(resolveRequestUrl("https://api.test", "/users")).toBe("https://api.test/users");
    expect(resolveRequestUrl("https://api.test/", "users")).toBe("https://api.test/users");
    expect(resolveRequestUrl("https://api.test/", "/users")).toBe("https://api.test/users");
  });

  it("leaves an absolute path alone", () => {
    expect(resolveRequestUrl("https://api.test", "https://other.test/x"))
      .toBe("https://other.test/x");
  });

  it("returns the path when there is no base url", () => {
    expect(resolveRequestUrl(undefined, "/users")).toBe("/users");
    expect(resolveRequestUrl("   ", "/users")).toBe("/users");
  });

  it("keeps variable placeholders untouched", () => {
    expect(resolveRequestUrl("{{BASE}}", "/users/{{id}}")).toBe("{{BASE}}/users/{{id}}");
  });
});
